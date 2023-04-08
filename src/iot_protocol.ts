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
    parts?: number
    client: TLSSocket | Socket
}

export type IoTMiddleware = (request: IoTRequest, next: () => void) => void

export interface IoTRequestResponse {
    onResponse: (response: IoTRequest) => void,
    onTimeout?: (request: IoTRequest) => void,
    timeout?: number,
}

export const IOT_VERSION = 0b000001;

export const IOT_PROTOCOL_BUFFER_SIZE = 1024;

export const IOT_ETX = 0x3
export const IOT_RS = 0x1E

export const IOT_MSCB_ID = 0b00000010
export const IOT_MSCB_PATH = 0b00000001
export const IOT_LSCB_HEADER = 0b00000010
export const IOT_LSCB_BODY = 0b00000001

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

    constructor(public delay = 300) {
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

        let offset = 0

        if (buffer.length < offset) return

        const MSCB = buffer.at(offset)!
        const LSCB = buffer.at(++offset)!

        request.version = MSCB >> 2
        request.method = LSCB >> 2

        /* ID */
        if (MSCB & IOT_MSCB_ID && buffer.length >= offset + 2) {
            request.id = buffer.readUInt16BE(++offset)
            offset++
        }

        /* PATH */
        if (MSCB & IOT_MSCB_PATH) {
            const indexEXT = buffer.indexOf(IOT_ETX, ++offset)
            if (indexEXT > -1) {
                request.path = buffer.subarray(offset, indexEXT).toString()
                offset = indexEXT
            }
        }

        /* HEADER */
        if (LSCB & IOT_LSCB_HEADER) {
            request.headers = {}

            offset++
            let indexKeyValue = -1
            let indexEXT = -1
            while ((indexKeyValue = buffer.indexOf(IOT_RS, offset)) && ((indexEXT = buffer.indexOf(IOT_ETX, offset + 1)) != -1) && indexKeyValue < indexEXT - 1) {
                request.headers![buffer.subarray(offset, indexKeyValue).toString()] = buffer.subarray(indexKeyValue + 1, indexEXT).toString()
                offset = indexEXT + 1
            }

            offset--
        }

        /* BODY */
        let remainBuffer: Buffer | null = null /* Remains data on buffer to be processed */
        if (LSCB & IOT_LSCB_BODY) {

            let bodyLengthSize = 2
            switch (request.method) {
                case EIoTMethod.SIGNAL:
                    bodyLengthSize = 1
                    break
                case EIoTMethod.STREAMING:
                    bodyLengthSize = 4
                    break
            }

            request.bodyLength = 0
            for (let i = bodyLengthSize; i > 0; i--) {
                request.bodyLength += buffer.at(++offset)! << ((i - 1) * 8)
            }

            /* Single Request */
            /* ...(17) EXT (18) 0 (19) 30 | (20) B (21) B (22) B + ...25B + (48) B , (49) B , (50) */

            /* Multi Request */
            /* ...(17) EXT (18) 4 (19) 36 | (20) B (21) B (22) B + ...999B + (1022) B , (1023) B , (1024) */
            /* ...(17) EXT (18) 4 (19) 36 | (20) B (21) B (22) B + ...51B + (74) B , (75) B , (76) */

            offset++ //20
            let bodyEndIndex = offset + request.bodyLength // 50 // 1080 | 1080
            let bodyIncomeLength = (buffer.length - offset) //50 - 20 = 30 // 1024 - 20 = 1004 | 76 - 20 = 56

            if (bodyIncomeLength > request.bodyLength) /* Income more than one request, so forward to next onData(remainBuffer) */ {
                remainBuffer = buffer.subarray(bodyEndIndex)
            } else if (bodyIncomeLength < request.bodyLength) /* Part Body data */ {
                bodyEndIndex = buffer.length // 1024 | 76
            }

            request.body = buffer.subarray(offset, bodyEndIndex) //[20-50] //[20-1024] | [20-76]
            offset = bodyEndIndex - 1
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

        let MSCB = request.version << 2
        let LSCB = request.method! << 2

        let bodyLengthBuffer = Buffer.allocUnsafe(2)
        if (request.body) bodyLengthBuffer.writeUInt16BE(request.body!.byteLength)

        LSCB += (((Object.keys(request.headers || {}).length > 0) ? IOT_LSCB_HEADER : 0) + ((request.body) ? IOT_LSCB_BODY : 0))

        switch (request.method) {
            case EIoTMethod.SIGNAL:
                MSCB += (((request.path) ? IOT_MSCB_PATH : 0))

                bodyLengthBuffer = Buffer.allocUnsafe(1)
                if (request.body) bodyLengthBuffer.writeUInt8(request.body!.byteLength)
                break
            case EIoTMethod.REQUEST:
                MSCB += ((IOT_MSCB_ID) + ((request.path) ? IOT_MSCB_PATH : 0))
                break
            case EIoTMethod.RESPONSE:
                MSCB += ((IOT_MSCB_ID))
                break
            case EIoTMethod.STREAMING:
                MSCB += ((IOT_MSCB_ID) + ((request.path) ? IOT_MSCB_PATH : 0))

                /* BODY LENGTH = uint32_t (4 bytes) */
                bodyLengthBuffer = Buffer.allocUnsafe(4)
                if (request.body) bodyLengthBuffer.writeUInt32BE(request.body!.byteLength)
                break
        }

        const controlBytes = Buffer.from([MSCB, LSCB])

        /* ID */
        let idBuffer = Buffer.allocUnsafe(2)
        if (MSCB & IOT_MSCB_ID) {
            if (!request.id) request.id = this.generateRequestId()
            idBuffer.writeUInt16BE(request.id)
        } else {
            idBuffer = Buffer.from([])
        }

        /* PATH */
        const pathBuffer = (MSCB & IOT_MSCB_PATH) ? [...Buffer.from(request.path!), ...Buffer.from([IOT_ETX])] : []

        /* HEADERs */
        const headerBuffer = (LSCB & IOT_LSCB_HEADER) ? Buffer.concat(Object.keys(request.headers!).map(key => Buffer.from([...Buffer.from(key), IOT_RS, ...Buffer.from(request.headers![key]), IOT_ETX]))) : ([])

        if ((pathBuffer.length + headerBuffer.length) > IOT_PROTOCOL_BUFFER_SIZE - 8) {
            throw new Error("Path and Headers too big")
        }

        /* BODY */
        let bodyBuffer = Buffer.from([])
        if ((LSCB & IOT_LSCB_BODY)) {
            bodyBuffer = Buffer.from([...request.body!])
        } else {
            bodyLengthBuffer = Buffer.from([])
        }

        const prefixDataBuffer = Buffer.from([
            ...controlBytes,
            ...idBuffer, /* ID */
            ...pathBuffer, /* PATH */
            ...headerBuffer, /* HEADERs */
            ...bodyLengthBuffer /* BODY LENGTH */
        ])

        if (requestResponse) {
            if (!requestResponse.timeout) requestResponse.timeout = 1000;
            this.requestResponse[request.id!] = requestResponse
        }

        return new Promise<IoTRequest>(async (resolve) => {

            const writeBodyPart = async (i = 0, parts = 0) => {
                return new Promise<number>(async (res) => {
                    const bodyBufferRemain = (bodyBuffer.length - i)
                    const bodyUntilIndex = ((bodyBufferRemain + prefixDataBuffer.length) > IOT_PROTOCOL_BUFFER_SIZE) ? i + (IOT_PROTOCOL_BUFFER_SIZE - prefixDataBuffer.length) : i + bodyBufferRemain  //1004 // 1060
                    const buffer = Buffer.from([
                        ...prefixDataBuffer,
                        ...bodyBuffer.subarray(i, bodyUntilIndex)
                    ])
                    i = bodyUntilIndex /* + 1 */

                    await delayPromise(this.delay)

                    request.client!.write(buffer, async () => {

                        // console.log("sent buffer...", `[${buffer.length}] => [${buffer.join(" , ")}]`)

                        parts++

                        if (i >= bodyBuffer.length) {
                            return res(parts)
                        } else {
                            return res(writeBodyPart(i, parts))
                        }

                    })
                })
            }

            request.parts = await writeBodyPart()

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

            return resolve(request)
        })
    }


}