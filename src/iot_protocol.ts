import { Socket } from "net"
import { TLSSocket } from "tls"

export enum EIoTMethod {
    SIGNAL = 0x1,
    REQUEST = 0x2,
    RESPONSE = 0x3,
    STREAMING = 0x4
}

export interface IoTRequest {
    version?: number,
    method?: EIoTMethod,
    id?: number,
    path?: string,
    headers?: {
        [key: string]: string
    },
    body?: Buffer,
    bodyLength?: number,
    client: TLSSocket | Socket
}

export type IoTMiddleware = (request: IoTRequest, next: () => void) => void

export interface IoTRequestResponse {
    onResponse: (response: IoTRequest) => void,
    onTimeout?: (request: IoTRequest) => void,
    timeout?: number,
}

export const IOT_VERSION = 0b000001;

export const IOT_ETX = 0x3
export const IOT_RS = 0x1E

export const IOT_MCB_ID = 0b00000010
export const IOT_MCB_PATH = 0b00000001
export const IOT_LCB_HEADER = 0b00000010
export const IOT_LCB_BODY = 0b00000001

const delayPromise = async (delayMs: number) => {
    return new Promise<void>((resolve) => {
        setTimeout(() => {
            resolve()
        }, delayMs)
    })
}

export class IoTProtocol {

    public middlewares: Array<IoTMiddleware> = []

    private requestResponse: {
        [id: number]: IoTRequestResponse
    } = {}

    constructor(public delay = 400) {
        this.middlewares = [];
    }

    use(middleware: IoTMiddleware) {
        this.middlewares.push(middleware)
    }


    runMiddleware = (request: IoTRequest, index: number = 0) => {
        if (index >= this.middlewares.length) return
        this.middlewares[index](request, () => {
            this.runMiddleware(request, (index + 1))
        })
    }

    onData(client: TLSSocket | Socket, buffer: Buffer) {
        // console.log("on data...", `[${buffer.length}] [${buffer.join(" , ")}]`)
        // console.log("on data...", `[${buffer.length}] > ${buffer.toString()}`)

        let request: IoTRequest = {
            version: 1,
            method: EIoTMethod.SIGNAL,
            id: undefined,
            path: undefined,
            headers: undefined,
            body: Buffer.alloc(0),
            client
        }

        let offset = 2

        if (buffer.length < offset) return

        const MCB = buffer.at(0)!
        const LCB = buffer.at(1)!

        request.version = MCB >> 2
        request.method = LCB >> 2

        /* ID */
        if (MCB & IOT_MCB_ID && buffer.length >= offset + 2) {
            request.id = buffer.readUInt16BE(offset)
            offset += 2
        }

        /* PATH */
        if (MCB & IOT_MCB_PATH) {
            const indexEXT = buffer.indexOf(IOT_ETX, offset)
            if (indexEXT > -1) {
                request.path = buffer.subarray(offset, indexEXT).toString()
                offset = indexEXT + 1
            }
        }

        /* HEADER */
        if (LCB & IOT_LCB_HEADER) {
            request.headers = {}
            let indexKeyValue = -1
            let indexEXT = -1
            while ((indexKeyValue = buffer.indexOf(IOT_RS, offset)) && ((indexEXT = buffer.indexOf(IOT_ETX, offset + 1)) != -1) && indexKeyValue < indexEXT - 1) {
                request.headers![buffer.subarray(offset, indexKeyValue).toString()] = buffer.subarray(indexKeyValue + 1, indexEXT).toString()
                offset = indexEXT + 1
            }
        }

        /* BODY */
        let remainBuffer: Buffer | null = null /* Remains data on buffer to be processed */
        if (LCB & IOT_LCB_BODY) {

            let bodyLengthSize = 2
            switch (request.method) {
                case EIoTMethod.SIGNAL:
                    bodyLengthSize = 1
                    break
                case EIoTMethod.STREAMING:
                    bodyLengthSize = 4
                    break
            }

            if (buffer.length < offset + bodyLengthSize) return

            if(bodyLengthSize === 2 ) request.bodyLength = buffer.readUInt16BE(offset)
            else if(bodyLengthSize === 1 ) request.bodyLength = buffer.readUInt8(offset)
            else if(bodyLengthSize === 4 ) request.bodyLength = buffer.readUInt32BE(offset)
            else return

            offset += bodyLengthSize

            if ((buffer.length - offset) >= request.bodyLength) {
                request.body = buffer.subarray(offset, offset + request.bodyLength)
                offset += request.bodyLength

                if (offset > buffer.length) {
                    remainBuffer = buffer.subarray(offset)
                }
            }
        }

        /* Response */
        if (request.method === EIoTMethod.RESPONSE) {
            if (this.requestResponse[request.id!]) {
                this.requestResponse[request.id!].onResponse(request)
                delete this.requestResponse[request.id!]
            }
        } else {
            /* Middleware */
            this.runMiddleware(request)
        }

        if (remainBuffer !== null) {
            this.onData(client, remainBuffer)
        }
    }

    listen(client: TLSSocket | Socket) {

        client.on("data", (buffer: Buffer) => {
            this.onData(client, buffer)
        })

    }

    generateRequestId(): number {
        const id = ((new Date()).getTime()) % 10000
        if (this.requestResponse[id] || id == 0) return this.generateRequestId()
        return id
    }

    signal(request: IoTRequest): Promise<IoTRequest> {
        request.method = EIoTMethod.SIGNAL
        return this.send(request)
    }

    request(request: IoTRequest, requestResponse?: IoTRequestResponse): Promise<IoTRequest> {
        request.method = EIoTMethod.REQUEST
        return this.send(request, requestResponse)
    }

    response(request: IoTRequest, body?: IoTRequest["body"], headers?: IoTRequest["headers"]): Promise<IoTRequest> {
        const response: IoTRequest = {
            version: IOT_VERSION,
            method: EIoTMethod.RESPONSE,
            id: request.id,
            headers,
            body,
            client: request.client
        }
        return this.send(response)
    }

    streaming(request: IoTRequest, requestResponse?: IoTRequestResponse): Promise<IoTRequest> {
        request.method = EIoTMethod.STREAMING
        return this.send(request, requestResponse)
    }

    async send(request: IoTRequest, requestResponse?: IoTRequestResponse): Promise<IoTRequest> {

        if (!request.version) {
            request.version = IOT_VERSION
        }

        let MCB = request.version << 2
        let LSB = request.method! << 2

        let bufferBodyLength = Buffer.allocUnsafe(2)
        if (request.body) bufferBodyLength.writeUInt16BE(request.body!.byteLength)

        switch (request.method) {
            case EIoTMethod.SIGNAL:
                MCB += (((request.path) ? IOT_MCB_PATH : 0))
                LSB += (((Object.keys(request.headers || {}).length > 0) ? IOT_LCB_HEADER : 0) + ((request.body) ? IOT_LCB_BODY : 0))

                bufferBodyLength = Buffer.allocUnsafe(1)
                if (request.body) bufferBodyLength.writeUInt8(request.body!.byteLength)
                break
            case EIoTMethod.REQUEST:
                MCB += ((0b10) + ((request.path) ? 0b01 : 0))
                LSB += (((Object.keys(request.headers || {}).length > 0) ? IOT_LCB_HEADER : 0) + ((request.body) ? IOT_LCB_BODY : 0))
                break
            case EIoTMethod.RESPONSE:
                MCB += ((0b10))
                LSB += (((Object.keys(request.headers || {}).length > 0) ? IOT_LCB_HEADER : 0) + ((request.body) ? IOT_LCB_BODY : 0))
                break
            case EIoTMethod.STREAMING:
                MCB += ((0b10) + ((request.path) ? 0b01 : 0))
                LSB += (((Object.keys(request.headers || {}).length > 0) ? IOT_LCB_HEADER : 0) + ((request.body) ? IOT_LCB_BODY : 0))

                /* BODY LENGTH = uint32_t (4 bytes) */
                bufferBodyLength = Buffer.allocUnsafe(4)
                if (request.body) bufferBodyLength.writeUInt32BE(request.body!.byteLength)
                break
        }

        const controlBytes = Buffer.from([MCB, LSB])

        /* ID */
        const bufferId = Buffer.allocUnsafe(2)
        if (MCB & IOT_MCB_ID) {
            if (!request.id) request.id = this.generateRequestId()
            bufferId.writeUInt16BE(request.id)
        }

        const buffer = Buffer.from([
            ...controlBytes,
            ...(MCB & IOT_MCB_ID) ? bufferId : [], /* ID */
            ...(MCB & IOT_MCB_PATH) ? [...Buffer.from(request.path!), ...Buffer.from([IOT_ETX])] : [], /* PATH */
            ...(LSB & IOT_LCB_HEADER) ? Buffer.concat(Object.keys(request.headers!).map(key => Buffer.from([...Buffer.from(key), IOT_RS, ...Buffer.from(request.headers![key]), IOT_ETX]))) : ([]), /* HEADERs */
            ...(LSB & IOT_LCB_BODY) ? [...bufferBodyLength, ...request.body!] : ([]), /* BODY */
        ])

        // console.log("sent buffer...", `[${buffer.length}] => [${buffer.join(" , ")}]`)

        if (requestResponse) {
            if (!requestResponse.timeout) requestResponse.timeout = 1000;
            this.requestResponse[request.id!] = requestResponse
        }

        return new Promise<IoTRequest>((resolve) => {
            request.client!.write(buffer, async () => {

                // await delayPromise(this.delay)

                resolve(request)

                /* Timeout */
                if (requestResponse) {
                    setTimeout(() => {
                        if (this.requestResponse[request.id!]) {
                            if (this.requestResponse[request.id!].onTimeout) {
                                this.requestResponse[request.id!].onTimeout!(request);
                            }
                            delete this.requestResponse[request.id!]
                        }
                    }, requestResponse.timeout)
                }

            })
        })
    }


}