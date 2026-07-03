import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./use-auth";

export function useIsAdmin() {
  const { user, loading } = useAuth();
  const [isAdmin, setIsAdmin] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let cancelled = false;
    if (loading) return;
    if (!user) {
      setIsAdmin(false);
      setChecking(false);
      return;
    }
    setChecking(true);
    supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        setIsAdmin(!!data);
        setChecking(false);
      });
    return () => { cancelled = true; };
  }, [user, loading]);

  return { isAdmin, checking };
}