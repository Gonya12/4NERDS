import { useCallback, useEffect, useRef, useState } from "react";
import {
  searchPokemonCardsManually,
  type ManualCardSearchInput,
  type ManualCardSearchPage,
} from "../services/sales/pokemonCardSearchService";

export function usePokemonCardSearch() {
  const [result, setResult] = useState<ManualCardSearchPage>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error>();
  const controller = useRef<AbortController | undefined>(undefined);
  const requestId = useRef(0);
  const lastInput = useRef<ManualCardSearchInput | undefined>(undefined);

  const cancel = useCallback(() => {
    requestId.current += 1;
    controller.current?.abort();
    setLoading(false);
  }, []);

  const search = useCallback(async (input: ManualCardSearchInput, append = false) => {
    controller.current?.abort();
    const nextController = new AbortController();
    controller.current = nextController;
    const currentRequest = ++requestId.current;
    lastInput.current = input;
    setLoading(true);
    setError(undefined);
    try {
      const response = await searchPokemonCardsManually(input, nextController.signal);
      if (currentRequest !== requestId.current || nextController.signal.aborted) return;
      setResult((current) => append && current
        ? {
          ...response,
          matches: [...new Map([...current.matches, ...response.matches].map((match) => [`${match.provider}:${match.providerCardId}`, match])).values()],
        }
        : response);
      return response;
    } catch (reason) {
      if (currentRequest !== requestId.current || nextController.signal.aborted) return;
      setError(reason instanceof Error ? reason : new Error("Card search failed."));
    } finally {
      if (currentRequest === requestId.current && !nextController.signal.aborted) setLoading(false);
    }
  }, []);

  const retry = useCallback(() => lastInput.current ? search(lastInput.current) : Promise.resolve(undefined), [search]);
  const clear = useCallback(() => {
    cancel();
    setResult(undefined);
    setError(undefined);
    lastInput.current = undefined;
  }, [cancel]);

  useEffect(() => cancel, [cancel]);
  return { result, loading, error, search, retry, cancel, clear };
}
