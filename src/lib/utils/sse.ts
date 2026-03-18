/**
 * SSE Helper using TransformStream pattern for Next.js App Router
 * 
 * TransformStream is critical because:
 * - ReadableStream buffers everything in Next.js App Router
 * - TransformStream allows streaming responses without buffering
 * - Write serialization prevents concurrent writes from interleaving
 */

export interface SSEStreamResult {
  response: Response;
  sendEvent: (data: unknown) => Promise<void>;
  close: () => Promise<void>;
}

/**
 * Create an SSE stream using TransformStream
 * 
 * Returns a Response object and a sendEvent function that serializes writes
 * to prevent interleaving from concurrent agents.
 */
export function createSSEStream(): SSEStreamResult {
  const { readable, writable } = new TransformStream<Uint8Array>();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  // Serialize writes to prevent interleaving from concurrent agents
  let writeChain = Promise.resolve();

  async function sendEventSerialized(data: unknown): Promise<void> {
    writeChain = writeChain.then(() =>
      writer.write(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
    );
    return writeChain;
  }

  async function close(): Promise<void> {
    try {
      await writeChain;
      await writer.close();
    } catch {
      // Already closed or error
    }
  }

  const response = new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });

  return {
    response,
    sendEvent: sendEventSerialized,
    close,
  };
}
