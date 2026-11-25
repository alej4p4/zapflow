import { auth } from "@/lib/auth";
import { SessionManager } from "@/components/dashboard/session-manager";

export const dynamic = "force-dynamic";

export default async function SessionsPage() {
    let session = null;
    try {
        session = await auth();
    } catch {}

    return (
        <div>
            <h1 className="text-2xl font-bold mb-6">Gerenciar sessões</h1>
            <SessionManager user={session?.user} />
        </div>
    );
}
