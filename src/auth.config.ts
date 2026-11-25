import type { NextAuthConfig } from "next-auth";

export const authConfig = {
    pages: {
        signIn: '/auth/login',
    },
    callbacks: {
        authorized({ auth, request }) {
            const { nextUrl } = request;
            const isLoggedIn = !!auth?.user;
            const isOnDashboard = nextUrl.pathname.startsWith('/dashboard');
            const proto = request.headers.get("x-forwarded-proto") || nextUrl.protocol.replace(":", "") || "http";
            const host = request.headers.get("x-forwarded-host") || request.headers.get("host") || nextUrl.host;
            const externalOrigin = `${proto}://${host}`;
            
            if (isOnDashboard) {
                if (isLoggedIn) return true;
                const loginUrl = new URL('/auth/login', externalOrigin);
                loginUrl.searchParams.set('callbackUrl', nextUrl.pathname);
                return Response.redirect(loginUrl);
            } else if (isLoggedIn && nextUrl.pathname === '/auth/login') {
                return Response.redirect(new URL('/dashboard', externalOrigin));
            }
            return true;
        },
        async jwt({ token, user }) {
            if (user) {
                token.id = user.id;
                token.role = (user as any).role;
                token.permissions = (user as any).permissions;
            }
            return token;
        },
        async session({ session, token }) {
            if (token && session.user) {
                session.user.id = token.id as string;
                (session.user as any).role = token.role;
                (session.user as any).permissions = token.permissions;
            }
            return session;
        }
    },
    providers: [], // Configured in auth.ts
    session: {
        strategy: 'jwt'
    },
    trustHost: true,
} satisfies NextAuthConfig;
