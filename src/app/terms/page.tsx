import Link from "next/link";
import { ArrowLeft, ShieldCheck, Scale } from "lucide-react";

export const metadata = {
    title: "Termos de Serviço | WA-AKG",
    description: "Termos de serviço do gateway autogerenciado do WhatsApp WA-AKG.",
    openGraph: {
        title: "Termos de Serviço | WA-AKG",
        description: "Termos de serviço do gateway autogerenciado do WhatsApp WA-AKG.",
        type: "website",
    },
    twitter: {
        card: "summary_large_image",
        title: "Termos de Serviço | WA-AKG",
        description: "Termos de serviço do gateway autogerenciado do WhatsApp WA-AKG.",
    },
};

export default function TermsPage() {
    return (
        <div className="min-h-screen bg-background relative overflow-hidden py-24 selection:bg-primary/30 selection:text-primary-foreground">
            {/* Ambient background glows */}
            <div className="fixed top-0 left-1/4 -translate-x-1/2 -translate-y-1/2 w-[40rem] h-[40rem] bg-emerald-500/5 dark:bg-emerald-500/10 rounded-full blur-[120px] pointer-events-none -z-10" />
            <div className="fixed bottom-0 right-1/4 translate-x-1/2 translate-y-1/2 w-[30rem] h-[30rem] bg-blue-500/5 dark:bg-blue-600/10 rounded-full blur-[100px] pointer-events-none -z-10" />

            <div className="container max-w-4xl px-4 mx-auto relative z-10">

                <Link href="/" className="inline-flex items-center text-sm font-medium text-muted-foreground hover:text-foreground mb-8 transition-colors group">
                    <ArrowLeft className="mr-2 h-4 w-4 transition-transform group-hover:-translate-x-1" />
                    Voltar ao início
                </Link>

                <div className="glass-panel p-8 md:p-12 rounded-3xl shadow-xl shadow-black/5 dark:shadow-black/20 animate-in fade-in slide-in-from-bottom-8 duration-700">
                    <div className="flex items-center gap-4 mb-8">
                        <div className="p-3 bg-primary/10 rounded-2xl">
                            <Scale className="h-8 w-8 text-primary" />
                        </div>
                        <div>
                            <h1 className="text-3xl md:text-5xl font-bold tracking-tight text-foreground">Termos de Serviço</h1>
                            <p className="text-muted-foreground mt-2">Última atualização: {new Date().toLocaleDateString("pt-BR")}</p>
                        </div>
                    </div>

                    <div className="prose prose-slate dark:prose-invert max-w-none prose-headings:font-bold prose-headings:tracking-tight prose-a:text-primary hover:prose-a:text-primary/80 prose-p:leading-relaxed">

                        <p className="lead text-lg text-muted-foreground mb-8">
                            Bem-vindo ao WA-AKG. Ao acessar ou usar nossa plataforma de gateway do WhatsApp, você concorda com estes termos. Se não concordar, não utilize o serviço.
                        </p>

                        <h2 className="flex items-center gap-2 mt-8 text-2xl border-b pb-2">
                            <ShieldCheck className="h-6 w-6 text-emerald-500" />
                            1. Segurança e responsabilidade pelos dados
                        </h2>
                        <p>
                            A segurança é fundamental. Como plataforma autogerenciada, o WA-AKG mantém seus dados na infraestrutura sob seu controle.
                        </p>
                        <ul>
                            <li><strong>Seus dados são seus:</strong> não rastreamos, interceptamos nem vendemos suas mensagens, contatos ou dados de sessão do WhatsApp.</li>
                            <li><strong>Uso seguro:</strong> você é responsável por proteger seu computador e o ambiente onde o aplicativo é executado.</li>
                            <li><strong>Autenticação:</strong> proteja suas credenciais e não compartilhe seus dados de acesso com pessoas não autorizadas.</li>
                        </ul>

                        <h2 className="mt-8 text-2xl border-b pb-2">2. Política de uso aceitável</h2>
                        <p>
                            Ao usar a API, as respostas automáticas e os disparos do WA-AKG, você concorda em respeitar os Termos de Serviço e as políticas antispam do WhatsApp. Você não deve:
                        </p>
                        <ul>
                            <li>Enviar spam ou campanhas em massa a pessoas que não autorizaram o recebimento.</li>
                            <li>Distribuir software malicioso, links de phishing ou conteúdo ilegal.</li>
                            <li>Tentar fazer engenharia reversa da API ou sobrecarregar o serviço com solicitações excessivas.</li>
                        </ul>

                        <h2 className="mt-8 text-2xl border-b pb-2">3. Integridade da conta</h2>
                        <p>
                            O WA-AKG permite gerenciar várias sessões do WhatsApp. Monitore os aparelhos conectados. Se suspeitar de acesso não autorizado ao painel, altere sua senha e desconecte as sessões suspeitas pelo próprio WhatsApp.
                        </p>

                        <h2 className="mt-8 text-2xl border-b pb-2">4. Isenções e limitações</h2>
                        <p>
                            O WA-AKG é fornecido "no estado em que se encontra", sem garantias. Ele usa bibliotecas de terceiros, como Baileys, para se conectar ao WhatsApp Web. Mudanças nos sistemas do WhatsApp podem interromper o serviço. Não nos responsabilizamos por suspensões ou banimentos decorrentes do uso.
                        </p>

                        <div className="mt-12 p-6 bg-primary/5 rounded-2xl border border-primary/10">
                            <p className="font-semibold mb-2">Ficou com dúvidas sobre estes termos?</p>
                            <p className="text-sm text-muted-foreground mb-0">Consulte a <Link href="/docs">documentação</Link> ou entre em contato com os responsáveis pelo projeto.</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
