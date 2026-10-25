"use client";

import useSWR from "swr";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { ApiError, fetcher } from "./api";
import type { Session } from "./types";

export function useSession({ redirectTo = "/login" }: { redirectTo?: string | null } = {}) {
  const router = useRouter();
  const { data, error, isLoading, mutate } = useSWR<Session>("/auth/me", fetcher, {
    shouldRetryOnError: false,
    revalidateOnFocus: false,
  });

  useEffect(() => {
    if (!redirectTo) return;
    if (error instanceof ApiError && error.status === 401) {
      router.replace(redirectTo);
    }
  }, [error, redirectTo, router]);

  useEffect(() => {
    const handler = () => {
      if (redirectTo) router.replace(redirectTo);
    };
    window.addEventListener("sendme:unauthorized", handler);
    return () => window.removeEventListener("sendme:unauthorized", handler);
  }, [redirectTo, router]);

  return { session: data, error, isLoading, mutate };
}
