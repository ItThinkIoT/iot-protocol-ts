import { Socket } from "net"
import { TLSSocket } from "tls"
import { delayPromise } from "./iot_helpers.js";

export const IOT_VERSION = 0b000001;

export const IOT_ETX = 0x3
export const IOT_RS = 0x1E

export const IOT_MSCB_ID = 0b00000010
export const IOT_MSCB_PATH = 0b00000001
export const IOT_LSCB_HEADER = 0b00000010
export const IOT_LSCB_BODY = 0b00000001

export const IOT_PROTOCOL_BUFFER_SIZE = 1024;

export const IOT_MULTIPART_TIMEOUT = 5000;

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
    totalBodyLength?: number,
    parts?: number
    client: TLSSocket | Socket
}

export type Next = () => void
export type IoTMiddleware = (request: IoTRequest, next: Next) => void

export type OnResponse = (response: IoTRequest) => void
export type OnTimeout = (request: IoTRequest) => void

export interface IoTRequestResponse {
    onResponse: OnResponse,
    onTimeout?: OnTimeout,

    timeout?: number
    timeoutHandle?: NodeJS.Timeout
}

export interface IoTMultiPart {
    parts: number, /* Number of Parts */
    received: number /* Bytes received */
    timeout: number
}

export interface IoTClient {
    id: string,
    client: TLSSocket | Socket,
    lockedForWrite: boolean
}
export class IoTProtocol {

    private clients : {
        [clientId: string]: IoTClient
    } = {}

    private requestResponse: {
        [id: number]: IoTRequestResponse
    } = {}

    private multiPartControl: {
        [id: number]: IoTMultiPart
    } = {}

    private remainBuffer: Buffer | null = null

    public middlewares: Array<IoTMiddleware> = []

    constructor(public timeout = 1000, public delay = 300) {
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

    getClientId(client: TLSSocket | Socket) : string {
        return `${client.remoteAddress}_${client.remotePort}`
    }

    listen(client: TLSSocket | Socket) {
        const iotClient : IoTClient = {
            client,
            id: this.getClientId(client),
            lockedForWrite: false
        }   
        this.clients[iotClient.id] = iotClient

        this.clients[iotClient.id].client.on("data", (buffer: Buffer) => {
            if (this.remainBuffer !== null && this.remainBuffer.length > 0) {
                buffer = Buffer.concat([this.remainBuffer, buffer])
                this.resetRemainBuffer()
            }

            this.onData(client, buffer)
        })

        this.clients[iotClient.id].client.on("end", ()=>{
            delete this.clients[iotClient.id]
        })
    }


    onData(client: TLSSocket | Socket, buffer: Buffer) {
        // console.log("on data...", `[${buffer.length}] [${buffer.join(" , ")}]`)
        // console.log("on data...", `[${buffer.length}] > ${buffer.toString()}`)

        let request: IoTRequest = {
            version: 1,
            method: EIoTMethod.SIGNAL,
            id: 0,
            path: undefined,
            headers: undefined,
            body: Buffer.alloc(0),
            bodyLength: 0,
            totalBodyLength: 0,
            parts: 0,
            client
        }

        let offset = 0

        if (!buffer || buffer.length < 2) return

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

            const headerSize = buffer.readUInt8(offset++)

            while ((indexKeyValue = buffer.indexOf(IOT_RS, offset)) &&
                ((indexEXT = buffer.indexOf(IOT_ETX, offset + 1)) != -1) &&
                indexKeyValue < indexEXT - 1) {
                request.headers![buffer.subarray(offset, indexKeyValue).toString()] = buffer.subarray(indexKeyValue + 1, indexEXT).toString()
                offset = indexEXT + 1

                if (Object.keys(request.headers).length == headerSize) {
                    break
                }
            }

            offset--
        }

        /* BODY */
        let requestCompleted = true

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
            request.totalBodyLength = request.bodyLength

            /* Single Request */
            /* ...(17) EXT (18) 0 (19) 30 | (20) B (21) B (22) B + ...25B + (48) B , (49) B , (50) */

            /* Multi Request */
            /* ...(17) EXT (18) 4 (19) 36 | (20) B (21) B (22) B + ...999B + (1022) B , (1023) B , (1024) */
            /* ...(17) EXT (18) 4 (19) 36 | (20) B (21) B (22) B + ...51B + (74) B , (75) B , (76) */

            offset++ //20

            let bodyIncomeLength = buffer.length - offset
            let bodyEndIndex = offset + request.bodyLength

            let multiPartControl = this.multiPartControl[request.id!]
            if (multiPartControl) {
                bodyEndIndex -= multiPartControl.received
            } else {
                this.multiPartControl[request.id!] = {
                    parts: 0,
                    received: 0,
                    timeout: IOT_MULTIPART_TIMEOUT
                }
                multiPartControl = this.multiPartControl[request.id!]
            }

            if (bodyEndIndex > buffer.length) {
                bodyEndIndex = buffer.length
            }

            request.bodyLength = bodyEndIndex - offset

            multiPartControl.parts++;
            multiPartControl.received += request.bodyLength
            multiPartControl.timeout = IOT_MULTIPART_TIMEOUT

            /* MultiPart Timeout */
            setTimeout(() => {
                if (this.multiPartControl[request.id!]) {
                    delete this.multiPartControl[request.id!]
                }
            }, multiPartControl.timeout)

            if (multiPartControl.received < request.totalBodyLength) {
                requestCompleted = false
            } else {
                delete this.multiPartControl[request.id!]
            }

            if (bodyIncomeLength > request.bodyLength) /* Income more than one request, so keeps it on remainBuffer */ {
                this.remainBuffer = buffer.subarray(bodyEndIndex)
            }

            request.body = buffer.subarray(offset, bodyEndIndex)

            offset = bodyEndIndex - 1
        }

        /* Response Response */
        if (this.requestResponse[request.id!]) {
            if (this.requestResponse[request.id!].onResponse != undefined) {
                this.requestResponse[request.id!].onResponse(request)
            }
            if (requestCompleted) {
                delete this.requestResponse[request.id!]
            } else {
                this.startRequestResponseTimeout(request)
            }
        }
        else {
            if (request.method !== EIoTMethod.RESPONSE) {
                /* Middleware */
                this.runMiddleware(request)
            }
        }
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

    response(request: IoTRequest): Promise<IoTRequest> {
        request.method = EIoTMethod.RESPONSE
        return this.send(request)
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

        LSCB += (((Object.keys(request.headers || {}).length > 0) ? IOT_LSCB_HEADER : 0) + ((request.body) ? IOT_LSCB_BODY : 0))

        switch (request.method) {
            case EIoTMethod.SIGNAL:
                MSCB += (((request.path) ? IOT_MSCB_PATH : 0))

                bodyLengthBuffer = Buffer.allocUnsafe(1)
                if (request.body) bodyLengthBuffer.writeUInt8(request.body!.byteLength)
                break
            case EIoTMethod.REQUEST:
                MSCB += ((IOT_MSCB_ID) + ((request.path) ? IOT_MSCB_PATH : 0))
                if (request.body) bodyLengthBuffer.writeUInt16BE(request.body!.byteLength)
                break
            case EIoTMethod.RESPONSE:
                MSCB += ((IOT_MSCB_ID))
                if (request.body) bodyLengthBuffer.writeUInt16BE(request.body!.byteLength)
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
        let headerBuffer = Buffer.from([])
        if (LSCB & IOT_LSCB_HEADER) {
            const headersKeys = Object.keys(request.headers!)

            if (headersKeys.length > 255) {
                throw new Error("Too many headers. Maximum Headers is 255.")
            }

            const headerSizeBuffer = Buffer.alloc(1)
            headerSizeBuffer.writeUInt8(headersKeys.length)

            headerBuffer = Buffer.concat(
                [headerSizeBuffer, ...headersKeys.map(key => Buffer.from([...Buffer.from(key), IOT_RS, ...Buffer.from(request.headers![key]), IOT_ETX]))]
            )
        }

        if ((pathBuffer.length + headerBuffer.length) > IOT_PROTOCOL_BUFFER_SIZE - 8) {
            throw new Error("Path and Headers too big.")
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
            if (!requestResponse.timeout) {
                requestResponse.timeout = this.timeout
            }
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
                    i = bodyUntilIndex

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

            while(this.clients[this.getClientId(request.client)].lockedForWrite) {
                await delayPromise(300)
                // console.log(`awatting for free... Request Method (${EIoTMethod[request.method!]})`)
            }
            this.clients[this.getClientId(request.client)].lockedForWrite = true
            request.parts = await writeBodyPart()
            this.clients[this.getClientId(request.client)].lockedForWrite = false

            /* Timeout */
            if (this.requestResponse[request.id!]) {
                this.startRequestResponseTimeout(request)
            }

            return resolve(request)
        })
    }

    resetRemainBuffer() {
        this.remainBuffer = null
    }

    startRequestResponseTimeout = (request: IoTRequest) => {
        let requestResponse = this.requestResponse[request.id!]
        if (requestResponse.timeoutHandle) clearTimeout(requestResponse.timeoutHandle)

        requestResponse.timeoutHandle = setTimeout(() => {
            if (this.requestResponse[request.id!]) {
                if (this.requestResponse[request.id!].onTimeout) {
                    this.requestResponse[request.id!].onTimeout!(request);
                }
                delete this.requestResponse[request.id!]
            }
        }, requestResponse.timeout || this.timeout)
    }

}