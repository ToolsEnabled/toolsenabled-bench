// Local project ownership and save state are independent of the editor and host UI.
export function createProjectSession({
  read,
  write,
  snapshot,
  load,
  isBusy = () => false,
  onState = () => {},
  onSaved = async () => {},
}) {
  const revisions = new Map(),
    generations = new Map(),
    saved = new Map(),
    pending = new Map(),
    errors = new Map();
  let current = null,
    switching = false,
    queue = Promise.resolve();
  const generation = (id) => generations.get(id) || 0;
  const state = () => {
    const dirty =
      !!current && generation(current) !== (saved.get(current) || 0);
    const saving = !!pending.get(current),
      error = errors.get(current);
    return {
      current,
      switching,
      dirty,
      saving,
      error,
      hasUnsavedChanges: dirty || saving || !!error,
      label: switching
        ? "Opening project…"
        : error
          ? "Not saved"
          : saving
            ? "Saving…"
            : dirty
              ? "Editing…"
              : "Saved locally",
    };
  };
  const publish = () => onState(state());
  const store = {
    async read(id) {
      const record = await read(id);
      revisions.set(id, record.revision);
      return record.draft;
    },
    save(id, draft) {
      const atGeneration = generation(id);
      pending.set(id, (pending.get(id) || 0) + 1);
      errors.delete(id);
      publish();
      const task = queue
        .then(async () => {
          if (!revisions.has(id))
            throw new Error("Open this project before saving it.");
          const result = await write(id, draft, revisions.get(id));
          revisions.set(id, result.revision);
          saved.set(id, atGeneration);
          errors.delete(id);
          await onSaved(id, result);
          return result;
        })
        .catch((error) => {
          errors.set(id, error.message);
          throw error;
        })
        .finally(() => {
          pending.set(id, pending.get(id) - 1);
          publish();
        });
      queue = task.catch(() => {});
      return task;
    },
  };
  async function saveCurrent() {
    if (!current) return;
    if (isBusy())
      throw new Error(
        "Wait for the current operation to finish before switching or saving.",
      );
    return store.save(current, snapshot());
  }
  return {
    store,
    get current() {
      return current;
    },
    get switching() {
      return switching;
    },
    get state() {
      return state();
    },
    get hasUnsavedChanges() {
      return state().hasUnsavedChanges;
    },
    markEdited() {
      if (!current || switching) return;
      generations.set(current, generation(current) + 1);
      publish();
    },
    saveCurrent,
    async select(id) {
      if (switching || isBusy())
        throw new Error(
          "Wait for the current operation to finish before switching or saving.",
        );
      switching = true;
      publish();
      try {
        // Reopening the current project (including run inspection) also saves pending fields.
        await saveCurrent();
        const result = await load(id);
        if (result?.ok === false)
          throw new Error(result.reason || "The project could not be opened.");
        current = id;
        saved.set(id, generation(id));
        errors.delete(id);
      } finally {
        switching = false;
        publish();
      }
    },
  };
}
