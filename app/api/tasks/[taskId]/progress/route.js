import { NextResponse } from 'next/server';

export async function GET(request, { params }) {
  const { taskId } = await params;
  const manager = require('@/lib/automation/manager');

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const listener = (event) => {
        const data = `data: ${JSON.stringify(event)}\n\n`;
        try {
          controller.enqueue(encoder.encode(data));
        } catch (e) {
          // Stream closed
          manager.removeListener(Number(taskId), listener);
        }
      };

      manager.addListener(Number(taskId), listener);

      // Send initial state
      const state = manager.getTaskState(Number(taskId));
      const initData = `data: ${JSON.stringify({ type: 'init', ...state })}\n\n`;
      controller.enqueue(encoder.encode(initData));

      // Clean up on close
      request.signal.addEventListener('abort', () => {
        manager.removeListener(Number(taskId), listener);
      });
    },
  });

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
