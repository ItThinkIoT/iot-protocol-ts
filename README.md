# IoT Protocol

IoT Protocol is a protocol over TCP based on HTTP and MQTT for lightweight data traffic.

**Motivation**: 
  1. HTTP 1.1 (*http://*) protocol is a request-response model is well-suited for web-based applications where clients need to request resources from servers and receive responses back. It is still more commonly used and more widely known among developers. But it uses too much data traffic for IoT context. Its minimum request size is 26 bytes (https://stackoverflow.com/a/25065027/1956719) and the HOST param is mandatory for all requests. 

  2. MQTT (*mqtt://*) is a publish-subscribe messaging protocol, use lightweight data traffic. Its minimum request size is 2 bytes. But it is not stateless and does not provide a request/response pattern, so it isn't restful. MQTT is designed to be a lightweight protocol that minimizes network overhead, which can make it more challenging to handle large or complex data payloads.

The **IOT PROTOCOL** (*iot://*) is base on HTTP and MQTT protocols. Is a request-response model adapted for IoT context designed for low-bandwidth, low-power devices. Its minimum request size is 2 bytes without requiring the HOST param for all requests. Supports Full Duplex and can be used for real-time communication up to 255 bytes, middleweight request up to (2^16 -1) bytes (~65Kb) and streaming up to (2^32 -1) bytes (~4.29Gb). Can use TLS/SSL encryption to secure their communications.


IOT PROTOCOL uses middlewares and router's filtering features based on [express nodejs module](https://expressjs.com/) at its Layer Application. Yes, you can use `.use(middleware)`, `.use('/path/to/your/resource', router)`, `response.send(data)` methods to handle the requests.


## Features

  - Lightweight protocol that minimizes network overhead
  - Minimum request size is 2 bytes
  - Request-response model like HTTP protocol
  - Adaptive requests methods for optimizing data length

---

## Preamble Version 1

```
<MCB + LCB>
[ID]
[PATH + ETX]
[HEADER + ETX]
[BODY_LENGTH + BODY] 
```

> `<...>` REQUIRED

> `[...]` OPTIONAL

---
### [0] **MCB**: MSB_CONTROL_BYTE

The Most Significant Control Byte.  **REQUIRED**

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
### [1] **LCB**: LSB_CONTROL_BYTE

The Least Significant Control Byte. **REQUIRED**
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

|Name                 | Description                     | MCB::ID   | MCB::PATH | LCB::METHOD | LCB::HEADER | LCB::BODY | BODY::LENGTH            | Minimun Total Length  |
|:--                  | :--                             | :--:      | :--:      | :--:        | :--:      | :--:        | :--                     | :--:                  |
| *Signal*            | Ligthweight signals like events | 0         | 0/1       | `0b000001`  | 0/1       | 0/1         | *up to 255 bytes*       | 2 bytes               |
| *Request*           | Request that needs response     | 1         | 0/1       | `0b000010`  | 0/1       | 0/1         | *up to 65535 bytes*     | 4 bytes               |
| *Response*          | Request's response              | 1         | 0         | `0b000011`  | 0/1       | 0/1         | *up to 65535 bytes*     | 4 bytes               |
| *Streaming*         | Streaming data                  | 1         | 0/1       | `0b000100`  | 0/1       | 0/1         | *up to (2^32 -1) bytes* | 4 bytes               |


---

### ETX

**ETX** byte serves to determine end of text

* Type: `char` | `byte` | `uint8_t`
* Size: `1 byte`
* Constant: 
  * char: `ETX` [Unicode - *End Of Text*](https://www.compart.com/en/unicode/U+0003)
  * hex: `0x3`
  * decimal: `3`
  * binary: `0b11`

---

### [2] **ID**: 

Unsigned random number with up to 2^16 that identifies the request. **SINGLE**

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

Format: `PATH + ETX`. **SINGLE**

* Type: `string`
* Example: `/foo/bar` + `EXT`
  
---

### [4] **HEADERS**:

Headers are be Key Value Pair that serves to set an attribute value for the request. Case sensitive.  

Format: `HEADER + EXT`. **MULTIPLE**

**HEADER**

* Type: `string`
* Format: `KEY + KEY_VALUE_SEPARATOR + VALUE`
* *KEY*: 
  * Type: `string`
* *VALUE*: 
  * Type: `string`
* *KEY_VALUE_SEPARATOR*: 
  * Type: `char` | `byte` | `uint8_t`
  * Size: `1 byte`
  * Constant: 
    * char: `RS` [Unicode - *Information Separator Two - RecordSeparator RS*](https://www.compart.com/en/unicode/U+001E)
    * hex: `0x1E`
    * decimal: `30`
    * binary: `0b011110`
* Example: 
  * Single header: `["foo", 0x1E, "bar", 0x3]`
  * Multiple headers: `["foo", 0x1E, "bar", 0x3, "lorem", 0x1E, "ipsum", 0x3]`


------------------

### [5] BODY

The final data to be sent for request receiver. 

Format: `BODY_LENGTH + BODY`. **OPTIONAL** | **SINGLE**

#### **BODY_LENGTH**: 

The body's length.  **REQUIRED**

  * Type: `uint8_t` | `uint16_t` | `uint32_t` as Big Endian format
  * Size: `1 / 2 / 4 bytes.` *Depends on the applied method*
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
      * uint_8[2]: `[ 0, 1, 9 , 17 ]`
      * binary: `0b00000000 00000001 00001001 00010001`

#### **BODY**:

The body / contents of request. **REQUIRED**

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
