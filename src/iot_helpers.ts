export const delayPromise = async (delayMs: number) => {
    return new Promise<void>((resolve) => {
        setTimeout(() => {
            resolve()
        }, delayMs)
    })
}