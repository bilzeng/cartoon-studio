// A submission already in flight must return its ticket before we can stop it.
export function generationControl(stopPrompt) {
  const controller = new AbortController();
  let submission, cancellation;
  async function stop() {
    if (submission) await stopPrompt((await submission).prompt_id);
    controller.abort();
  }
  return {
    signal: controller.signal,
    submit(send) {
      controller.signal.throwIfAborted();
      return submission = send();
    },
    cancel() {
      if (controller.signal.aborted) return Promise.resolve();
      return cancellation ??= stop().finally(() => { cancellation = null; });
    },
    get cancelling() { return cancellation; },
  };
}
