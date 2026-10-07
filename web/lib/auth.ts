import { redirect } from "next/navigation";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

const PROTECTED_PATHS = ["/dashboard", "/settings", "/team", "/import", "/insights"];

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const email = credentials?.email;
        const password = credentials?.password;
        if (typeof email !== "string" || typeof password !== "string") {
          return null;
        }

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) return null;

        const valid = await bcrypt.compare(password, user.passwordHash);
        if (!valid) return null;

        return { id: user.id, email: user.email };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.id = user.id;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user && typeof token.id === "string") {
        session.user.id = token.id;
      }
      return session;
    },
    authorized({ auth, request }) {
      const isProtected = PROTECTED_PATHS.some((path) =>
        request.nextUrl.pathname.startsWith(path)
      );
      if (!isProtected) return true;
      return Boolean(auth?.user);
    },
  },
});

/**
 * Sessions are JWT-only (no DB-backed session store), so a deleted user's
 * cookie stays cryptographically valid until it expires. Redirect to login
 * instead of crashing when the row it points to is gone.
 */
export async function requireUser(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) redirect("/login");
  return user;
}

export async function signOutAction() {
  "use server";
  await signOut({ redirectTo: "/login" });
}
