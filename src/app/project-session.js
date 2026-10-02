// Local project ownership and save state are independent of the editor and host UI.
export function createProjectSession({
  read,
  write,
  snapshot,
  identify,
  load,
  isBusy = () => false,
  onState = () => {},
  onSaved = async () => {},
}) {
  const identities = new Map(), queuedIdentities = new Map();
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
        : !current
          ? "No project selected"
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
      const identity = identify?.(draft);
      const queued = queuedIdentities.get(id) || [];
      const entry = { identity };
      queued.push(entry);
      queuedIdentities.set(id, queued);
      pending.set(id, (pending.get(id) || 0) + 1);
      publish();
      const task = queue
        .then(async () => {
          if (!revisions.has(id))
            throw new Error("Open this project before saving it.");
          // Recheck in the save queue: two requests for the same edit must
          // not produce two revisions, and hydration must never be persisted.
          if (identify && !errors.has(id) && identities.get(id) === identity) {
            saved.set(id, atGeneration);
            errors.delete(id);
            return { revision: revisions.get(id) };
          }
          const result = await write(id, draft, revisions.get(id));
          if (identify) identities.set(id, identity);
          revisions.set(id, result.revision);
          saved.set(id, atGeneration);
          errors.delete(id);
          await onSaved(id, result);
          return result;
        })
        .catch((error) => {
          // A failed write (especially a revision conflict) gives no assurance
          // that the old cached identity is still what is on disk.
          identities.delete(id);
          errors.set(id, error.message);
          throw error;
        })
        .finally(() => {
          queued.splice(queued.indexOf(entry), 1);
          if (!queued.length) queuedIdentities.delete(id);
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
      if (!current || switching) return false;
      // Compare with the end of the save queue. A revert to the confirmed
      // identity is still an edit when an older queued write will replace it.
      const queued = queuedIdentities.get(current);
      const projected = queued?.length ? queued.at(-1).identity : identities.get(current);
      if (identify && !errors.has(current) && projected === identify(snapshot())) return false;
      generations.set(current, generation(current) + 1);
      publish();
      return true;
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
        // Once loading starts the editor may change before it reports failure.
        // No prior project may own a snapshot produced by that partial load.
        current = null;
        publish();
        const result = await load(id);
        if (result?.ok === false)
          throw new Error(result.reason || "The project could not be opened.");
        current = id;
        if (identify) identities.set(id, identify(snapshot()));
        saved.set(id, generation(id));
        errors.delete(id);
      } finally {
        switching = false;
        publish();
      }
    },
  };
}
