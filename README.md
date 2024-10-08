# IoT Protocol

IoT Protocol is a protocol over TCP based on HTTP and MQTT for lightweight data traffic.

**Motivation**: 
  1. HTTP 1.1 (*http://*) protocol is a request-response model is well-suited for web-based applications where clients need to request resources from servers and receive responses back. It is still more commonly used and more widely known among developers. But it uses too much data traffic for IoT context. Its minimum request size is 16 bytes (https://stackoverflow.com/a/25065027/1956719) and the HOST param is mandatory for all requests. 

  2. MQTT (*mqtt://*) is a publish-subscribe messaging protocol, use lightweight data traffic. Its minimum request size is 2 bytes. But it is not stateless and does not provide a request/response pattern, so it isn't restful. MQTT is designed to be a lightweight protocol that minimizes network overhead, which can make it more challenging to handle large or complex data payloads.

The **IOT PROTOCOL** (*iot://*) is based on HTTP and MQTT protocols over TCP/IP. Is a request-response model adapted for IoT context designed for low-bandwidth, low-power devices. Its minimum request size is 2 bytes without requiring the HOST param for all requests. Supports Full Duplex and can be used for real-time communication up to 255 bytes, middleweight request up to (2^16 -1) bytes (~65Kb) and streaming up to (2^32 -1) bytes (~4.29Gb). Can use TLS/SSL encryption to secure its communications.


IOT PROTOCOL uses middlewares and router's filtering features based on [express nodejs module](https://expressjs.com/) under its Application Layer. Yes, you can use `.use(middleware)`, `.use('/path/to/your/resource', router)`, `response.send(data)` methods to handle the requests.


## Features

  - Lightweight protocol that minimizes network overhead
  - Minimum request size is 2 bytes
  - Request-response model like HTTP protocol
  - Adaptive requests methods for optimizing data length
  - Multipart (Send large data)
  - Streamming data

---

## **Comparison Summary** HTTP vs MQTT vs IOT

|     | MQTT  | HTTP 1.1  | IOT   |
| :-- | :--:  | :--:  | :--:  |
| Full Name | MQTT (the OASIS standardization group decided it would not stand for anything) | Hyper Text Transfer Protocol | Internet Of Thing Protocol |
| Architecture | Publish subscribe (MQTT does have a request/reply mode as well) | Request response | Request response |
| Command targets | Topics | URIs | URIs |
| Underlying Protocol | TCP/IP | TCP/IP | TCP/IP |
| Secure connections | TLS + username/password (SASL support possible) | TLS + username/password (SASL support possible) | TLS + username/password (SASL support possible) |
| Client observability | Known connection status (will messages) | Unknown connection status | Known connection status (will messages) |
| Messaging Mode | Asynchronous, event-based | Synchronous | Asynchronous, event-based |
| Message queuing | The broker can queue messages for disconnected subscribers | Application needs to implement | Application needs to implement |
| Message overhead | 2 bytes minimum. Header data can be binary | 16 bytes minimum (header data is text - compression possible) + HOST | 2 bytes minimum|
| Message Size | 256MB maximum | No limit but 256MB is beyond normal use cases anyway | 256 bytes / 65Kb / 4.29Gb maximum |
| Content type | Any (binary) | Text (Base64 encoding for binary) | Any (binary) |
| Message distribution | One to many | One to one | One to one (One to many not implemented yet) |
| Reliability | Three qualities of service: 0 - fire and forget, 1 - at least once, 2 - once and only once | Has to be implemented in the application | Has to be implemented in the application |
| Streaming | Application needs to implement | Application needs to implement | Yes |

## **Overhead Performance in IoT**

Overhead Performance in bytes for each operation

|     | MQTT (bytes) | HTTP 1.1 (bytes) | IOT (bytes) |
| :-- | :--:  | :--:  | :--:  |
| Establish connection 
| Disconnect 
| For each message published 
| Sum for 1 message 
| Sum for 10 messages
| Sum for 100 messages
| Sum for 1000 messages

## **Time Performance in IoT**

Time Performance in ms for response time per message

| No. messages in a connection | MQTT avg. response time per message (ms) (QoS 1) | HTTP avg. response time per message (ms) | IOT avg. response time per message (ms) (Request Method)  |
| :--:| :--:  | :--:  | :--:  |
| 1   | 113 | 289 | 
| 100 | 47  | 289 | 
| 1000| 43  | 289 | 

---

## Preamble Version 1

```
<MSCB>
<LSCB>
[ID]
[PATH]
[HEADER]
[BODY]
```

> `<...>` REQUIRED

> `[...]` OPTIONAL

## Limitations

> `(PATH + HEADER)` **MUST NOT BE MORE THAN 1016 Bytes** 
> 
>       + 1024 Bytes : IOT_PROTOCOL_BUFFER_SIZE
>          - 1 Byte  : MSCB_SIZE 
>          - 1 Byte  : LSCB_SIZE 
>          - 2 Bytes : ID_SIZE 
>          - 4 Bytes : BODY_LENGTH_MAXIMUM_SIZE (Streaming)
>        ----------------
>          + 1016 Bytes > [PATH]_SIZE + [HEADER]_SIZE
> 
>     |--------------------------------IOT_PROTOCOL_BUFFER_SIZE(1024)-----------------------------|
>
>     |--MSCB(1)--|
>  
>                 |--LSCB(1)--| 
>  
>                             |--ID_SIZE(2)--| 
>
>                                            |--PATH--|
>
>                                                     |--HEADER--|
>
>                                                                |--BODY_LENGTH_MAXIMUM_SIZE(4)--|
> 
> 

> Maximum of 255 headers per request  

---

### IOT_PROTOCOL_BUFFER_SIZE

**IOT_PROTOCOL_BUFFER_SIZE** is the maximum size of request. If `all data length > IOT_PROTOCOL_BUFFER_SIZE`, the data is spplited in parts of *IOT_PROTOCOL_BUFFER_SIZE* length. Each part keeps the prefixed data (`MSCB + LSCB + ID + PATH + HEADER + BODY_LENGTH`) and attachs the remain body until its length is *IOT_PROTOCOL_BUFFER_SIZE* length or less.

* Type: `size_t` | `uint32_t`
* Size: `4 bytes`
* Default value: `1024`
---

### IOT_ETX

**IOT_ETX** byte serves to determine end of text

* Type: `char` | `byte` | `uint8_t`
* Size: `1 byte`
* Constant: 
  * char: `ETX` [Unicode - *End Of Text*](https://www.compart.com/en/unicode/U+0003)
  * hex: `0x3`
  * decimal: `3`
  * binary: `0b11`

---
### IOT_RS

**IOT_RS** byte serves as record or key value pair separator

* Type: `char` | `byte` | `uint8_t`
* Size: `1 byte`
* Constant: 
  * char: `RS` [Unicode - *Information Separator Two - RecordSeparator RS*](https://www.compart.com/en/unicode/U+001E)
  * hex: `0x1E`
  * decimal: `30`
  * binary: `0b011110`

---
### [0] **MSCB**

The **Most Significant Control Byte**.  

Preamble: `<MSCB>` **REQUIRED** | **SINGLE**

  * Size: `1 byte`
  * Default: `0b00000100` = `4` = `0x4`

| Name    | Description                                 | Bit 7 | Bit 6 | Bit 5 | Bit 4| Bit 3  | Bit 2 | Bit 1 | Bit 0 | Default     |
| :---    | :---                                        | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---:       |
| VERSION | Version of iot protocol                     | X     | X     | X     | X     | X     | X     |       |       | *0b*000001  |
| ID      | Enable = 1 / Disable = 0 **ID**entification |       |       |       |       |       |       | X     |       | *0b*0       |
| PATH    | Enable = 1 / Disable = 0 **PATH**           |       |       |       |       |       |       |       | X     | *0b*0       |

#### Version:
  - Range: `from 1 up to 63`. Zero is reserved.

---
### [1] **LSCB**

The **Least Significant Control Byte**.

Preamble: `<LSCB>` **REQUIRED** | **SINGLE**

  * Size: `1 byte`
  * Default: `0b00000100` = `4` = `0x4`

| Name      | Description                                 | Bit 7 | Bit 6 | Bit 5 | Bit 4| Bit 3  | Bit 2 | Bit 1 | Bit 0 | Default     |
| :---      | :---                                        | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---:       |
| METHOD    | Type of request                             | X     | X     | X     | X     | X     | X     |       |       | *0b*000001  |
| HEADER    | Enable = 1 / Disable = 0 **HEADER**         |       |       |       |       |       |       | X     |       | *0b*0       |
| BODY      | Enable = 1 / Disable = 0 **BODY**           |       |       |       |       |       |       |       | x     | *0b*0       |


#### METHOD:

  - Range: `from 1 up to 63`. Zero is reserved.

Methods Types

|Name                 | Description                     | MSCB::ID   | MSCB::PATH | LSCB::METHOD | LSCB::HEADER | LSCB::BODY | BODY::LENGTH            | Minimum Total Length  |
|:--                  | :--                             | :--:      | :--:      | :--:        | :--:      | :--:        | :--                     | :--:                  |
| *Signal*            | Ligthweight signals like events | 0         | 0/1       | `0b000001`  | 0/1       | 0/1         | `1 byte` => body_content *up to 255 bytes*       | 2 bytes               |
| *Request*           | Request that needs response     | 1         | 0/1       | `0b000010`  | 0/1       | 0/1         | `2 bytes` => body_content *up to 65535 bytes*     | 4 bytes               |
| *Response*          | Request's response              | 1         | 0         | `0b000011`  | 0/1       | 0/1         | `2 bytes` => body_content *up to 65535 bytes*     | 4 bytes               |
| *Streaming*         | Streaming data                  | 1         | 0/1       | `0b000100`  | 0/1       | 0/1         | `4 bytes` => body_content *up to (2^32 -1) bytes* | 6 bytes               |
| *Alive Request*     | Request Alive         | 0         | 0         | `0b000101`  | 0         | 0           | `0 byte`               | 2 bytes               |
| *Alive Response*    | Respond the alive's request                        | 0         | 0         | `0b000110`  | 0         | 0           | `0 byte`               | 2 bytes               |
| *Buffer Size*       | Set buffer size                 | 0         | 0         | `0b000111`  | 0         | 1           | `1 byte` fixed with value `4` => body_content is `uint32_t`             | 7 bytes               |

<details>

> ### **Alive Method**
> 
> Heartbeat mechanism to determine if the connection is still alive or if it has been closed. 
>
> Both sides, client and server, keep sends alives requests. Who receives first, responds first and not emmit alives request. 
>
> Heartbeat interval defines the request period time in seconds. Client and server can have different heartbeat interval
>
> Default heartbeat interval: 60 seconds 
> 
> To disable heartbeat mechanism, set interval to 0 (zero) after start listen 
>

> ### **Buffer Size**
> 
> Buffer Size method allows to change the size of buffer for the next data transfers.
>
> Default buffer size: 1024 bytes.
>
> `BODY::LENGTH`: fixed at 4 bytes.
> 
> `BODY`: `uint32_t` (4 bytes as Big Endian format) allows set the buffer size up to (2^32 -1) bytes.
>
> To set to default value (1024) set body to 0 (zero).
>

</details>

---

### [2] **ID**: 

Unsigned random number with up to 2^16 that identifies the request.

Preamble: `[<ID>]` **OPTIONAL** | **SINGLE**

* Type: `uint16_t` as Big Endian format 
* Size: `2 bytes`
* Example: 
    * decimal: `276`
    * uint_8[2]: `[ 1 , 20 ]`
    * binary: `0b00000001 00010100`

--- 
### [3] **PATH**:

The path component contains data, usually organized in hierarchical
form, that, serves to identify a resource [URI > 3.3 Path](https://www.rfc-editor.org/info/rfc3986). 

Preamble: `[<PATH> + <IOT_ETX>]`. **OPTIONAL** | **SINGLE**

#### **PATH**

* Type: `string`
* Example: `/foo/bar`
  
---

### [4] **HEADER**:

Header is a Key Value Pair that serves to set an attribute value for the request. Case sensitive. Maximum of 255 headers.

Preamble: `[<HEADER_SIZE> + <HEADERs>]`. **OPTIONAL** | **SINGLE**

### **HEADER_SIZE** 

The amount of headers from 1 until 255 headers. **REQUIRED** | **SINGLE**

* Type: `byte` | `uint8_t`
* Size: `1 byte`

#### **HEADERs**

The key-value pair of one header. 

Preamble: `<KEY + IOT_RS + VALUE + IOT_ETX>` **REQUIRED** | **MULTIPLE** (Minimum 1)

* Type: `uint8_t[]`
* *KEY*: 
  * Type: `string`
* *VALUE*: 
  * Type: `string`

* Example: 
  * Single header (HEADER_SIZE = 1): `["foo", IOT_RS, "bar", IOT_ETX]` 
  * Multiple headers (HEADER_SIZE = 2): `["foo", IOT_RS, "bar", IOT_ETX, "lorem", IOT_RS, "ipsum", IOT_ETX]` 


------------------

### [5] BODY

The final data to be sent for request receiver. 

Preamble: `[<BODY_LENGTH> + <BODY>]`. **OPTIONAL** | **SINGLE**

#### **BODY_LENGTH**: 

The body's length.  **REQUIRED**

  * Type: `uint8_t` | `uint16_t` | `uint32_t` as Big Endian format
  * Size: `1 / 2 / 4 bytes.` *Depends on the used method*
  * Example:
    * `uint8_t`
      * decimal: `17`
      * uint_8[1]: `[ 17 ]`
      * binary: `0b00010001`

    * `uint16_t`
      * decimal: `2321`
      * uint_8[2]: `[ 9 , 17 ]`
      * binary: `0b00001001 00010001`

    * `uint32_t`
      * decimal: `67857`
      * uint_8[4]: `[ 0, 1, 9 , 17 ]`
      * binary: `0b00000000 00000001 00001001 00010001`

#### **BODY_CONTENT**:

The body contents of request. **REQUIRED**

* Type: `uint8_t[]`
* Example:
  * String: `the message`
  * Buffer: `[ 116, 104, 101, 32, 109, 101, 115, 115, 97, 103, 101 ]`

--- 

## Middlewares

@TODO Explains what is a middleware and how its works

## Listen

@TODO Explains what listener method does

## Examples

@TODO List of examples on `/examples`

## References 

- `HTTP/1.1` Fielding, R., Ed., Nottingham, M., Ed., and J. Reschke, Ed., "HTTP/1.1", STD 99, RFC 9112, DOI 10.17487/RFC9112, June 2022, <https://www.rfc-editor.org/info/rfc9112>.
  
- `URI` Berners-Lee, T. Fielding, R. L. Masinter "Uniform Resource Identifier (URI): Generic Syntax" STD 66 RFC 3986 DOI 10.17487/RFC3986 <https://www.rfc-editor.org/info/rfc3986>.

- `UNICODE` Compart. Unicode Character <https://www.compart.com/en/unicode>

- `MQTT` MQTT. MQTT 5 Specification <https://docs.oasis-open.org/mqtt/mqtt/v5.0/mqtt-v5.0.html>
