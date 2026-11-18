import { useCallback, useEffect, useRef, useState } from 'react';

// Загрузка данных с состоянием: { data, error, loading, reload, setData }.
// deps — когда перезагружать; fetcher получает AbortSignal.
export function useLoad(fetcher, deps = []) {
  const [state, setState] = useState({ data: undefined, error: null, loading: true });
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const controllerRef = useRef(null);

  const run = useCallback((silent = false) => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    if (!silent) setState((s) => ({ ...s, loading: true, error: null }));
    return Promise.resolve(fetcherRef.current(controller.signal))
      .then((data) => { if (!controller.signal.aborted) setState({ data, error: null, loading: false }); return data; })
      .catch((error) => {
        if (error?.name === 'AbortError' || controller.signal.aborted) return undefined;
        setState((s) => ({ ...s, error, loading: false }));
        return undefined;
      });
  }, []);

  useEffect(() => {
    run();
    return () => controllerRef.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const setData = useCallback((updater) => setState((s) => ({
    ...s, data: typeof updater === 'function' ? updater(s.data) : updater,
  })), []);

  return { ...state, reload: run, setData };
}

// Выполнение действия (кнопка) с флагом занятости.
export function useAction(action, { onSuccess, onError } = {}) {
  const [busy, setBusy] = useState(false);
  const run = useCallback(async (...args) => {
    setBusy(true);
    try {
      const result = await action(...args);
      onSuccess?.(result);
      return result;
    } catch (error) {
      if (onError) onError(error); else throw error;
      return undefined;
    } finally {
      setBusy(false);
    }
  }, [action, onSuccess, onError]);
  return [run, busy];
}

export function useDebounced(value, delay = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

export function useDocumentTitle(title) {
  useEffect(() => { if (title) document.title = `${title} · Service Portal`; }, [title]);
}
