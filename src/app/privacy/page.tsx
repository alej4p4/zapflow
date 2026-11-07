import Link from "next/link";
import { ArrowLeft, Lock, Shield } from "lucide-react";

export const metadata = {
    title: "Política de Privacidade | BarraSoftware",
    description: "Política de privacidade do gateway autogerenciado do WhatsApp BarraSoftware.",
    openGraph: {
        title: "Política de Privacidade | BarraSoftware",
        description: "Política de privacidade do gateway autogerenciado do WhatsApp BarraSoftware.",
        type: "website",
    },
    twitter: {
        card: "summary_large_image",
        title: "Política de Privacidade | BarraSoftware",
        description: "Política de privacidade do gateway autogerenciado do WhatsApp BarraSoftware.",
    },
};

export default function PrivacyPage() {
    return (
        <div className="min-h-screen bg-background relative overflow-hidden py-24 selection:bg-primary/30 selection:text-primary-foreground">
            {/* Ambient background glows */}
            <div className="fixed top-0 right-1/4 translate-x-1/2 -translate-y-1/2 w-[40rem] h-[40rem] bg-blue-500/5 dark:bg-blue-500/10 rounded-full blur-[120px] pointer-events-none -z-10" />
            <div className="fixed bottom-0 left-1/4 -translate-x-1/2 translate-y-1/2 w-[30rem] h-[30rem] bg-emerald-500/5 dark:bg-emerald-600/10 rounded-full blur-[100px] pointer-events-none -z-10" />

            <div className="container max-w-4xl px-4 mx-auto relative z-10">

                <Link href="/" className="inline-flex items-center text-sm font-medium text-muted-foreground hover:text-foreground mb-8 transition-colors group">
                    <ArrowLeft className="mr-2 h-4 w-4 transition-transform group-hover:-translate-x-1" />
                    Voltar ao início
                </Link>

                <div className="glass-panel p-8 md:p-12 rounded-3xl shadow-xl shadow-black/5 dark:shadow-black/20 animate-in fade-in slide-in-from-bottom-8 duration-700">
                    <div className="flex items-center gap-4 mb-8">
                        <div className="p-3 bg-blue-500/10 rounded-2xl">
                            <Shield className="h-8 w-8 text-blue-500" />
                        </div>
                        <div>
                            <h1 className="text-3xl md:text-5xl font-bold tracking-tight text-foreground">Política de Privacidade</h1>
                            <p className="text-muted-foreground mt-2">Vigência: {new Date().toLocaleDateString("pt-BR")}</p>
                        </div>
                    </div>

                    <div className="prose prose-slate dark:prose-invert max-w-none prose-headings:font-bold prose-headings:tracking-tight prose-a:text-primary hover:prose-a:text-primary/80 prose-p:leading-relaxed">

                        <p className="lead text-lg text-muted-foreground mb-8">
                            No BarraSoftware, acreditamos que seus dados pertencem a você. Esta política explica como as informações são tratadas ao usar nosso gateway do WhatsApp de código aberto e autogerenciado.
                        </p>

                        <h2 className="flex items-center gap-2 mt-8 text-2xl border-b pb-2">
                            <Lock className="h-6 w-6 text-blue-500" />
                            1. Arquitetura sem rastreamento
                        </h2>
                        <p>
                            Como o BarraSoftware é <strong>autogerenciado</strong>, o processamento principal dos dados ocorre no equipamento onde você instala o aplicativo.
                        </p>
                        <ul>
                            <li><strong>Sem telemetria centralizada:</strong> os criadores do BarraSoftware não recebem telemetria, análises ou relatórios de uso sobre suas interações no WhatsApp.</li>
                            <li><strong>Seus dados são seus:</strong> contatos, mensagens, agendamentos e respostas automáticas ficam no seu banco de dados. Não temos acesso a eles.</li>
                        </ul>

                        <h2 className="mt-8 text-2xl border-b pb-2">2. Dados processados localmente</h2>
                        <p>
                            Ao instalar o gateway, o aplicativo no seu computador interage com:
                        </p>
                        <ul>
                            <li><strong>Credenciais de acesso:</strong> as senhas do painel são protegidas com hash bcrypt antes de serem armazenadas no banco local.</li>
                            <li><strong>Sessões do WhatsApp:</strong> o BarraSoftware conecta-se ao WhatsApp Web e armazena localmente as chaves necessárias para manter a conexão.</li>
                            <li><strong>Histórico de comunicações:</strong> mensagens enviadas e recebidas são registradas no banco local para consulta e uso em webhooks.</li>
                        </ul>

                        <h2 className="mt-8 text-2xl border-b pb-2">3. Proteção das suas informações</h2>
                        <p>
                            Embora o BarraSoftware use práticas modernas de segurança, a proteção dos seus dados também depende do ambiente onde o aplicativo é executado. Recomendamos:
                        </p>
                        <ul>
                            <li>Usar um proxy reverso com criptografia <strong>SSL/TLS</strong> (HTTPS) quando expuser o app à internet.</li>
                            <li>Proteger o servidor com firewall e autenticação por chave SSH.</li>
                            <li>Manter o sistema operacional e o Node.js atualizados.</li>
                        </ul>

                        <h2 className="mt-8 text-2xl border-b pb-2">4. Integrações de terceiros</h2>
                        <p>
                            O BarraSoftware usa a biblioteca <code>@whiskeysockets/baileys</code> para se comunicar com os servidores do WhatsApp. O uso do WhatsApp continua sujeito à Política de Privacidade da Meta.
                        </p>

                        <div className="mt-12 p-6 bg-blue-500/5 rounded-2xl border border-blue-500/10">
                            <p className="font-semibold mb-2">Precisa de mais informações?</p>
                            <p className="text-sm text-muted-foreground mb-0">Para dúvidas sobre o tratamento de dados ou para auditar o código, visite nosso <Link href="https://github.com/mrifqidaffaaditya/BarraSoftware">repositório no GitHub</Link>.</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
