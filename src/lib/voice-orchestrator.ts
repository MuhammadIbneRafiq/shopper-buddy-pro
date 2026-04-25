let stopListeningHandler: (() => void) | null = null;

export function registerStopListening(handler: (() => void) | null) {
  stopListeningHandler = handler;
}

export function stopActiveListening() {
  stopListeningHandler?.();
}
