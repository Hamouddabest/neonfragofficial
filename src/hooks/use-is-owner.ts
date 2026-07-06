import { useAuth } from "./use-auth";

export const OWNER_EMAIL = "totallybro541@gmail.com";

export function useIsOwner() {
  const { user, loading } = useAuth();
  const isOwner = !!user?.email && user.email.toLowerCase() === OWNER_EMAIL;
  return { isOwner, loading };
}
