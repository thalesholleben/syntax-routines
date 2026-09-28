// Layout do aviso interno aprovado em 28/09/2026 (folha de e-mails da SyntaxLab, base/layout-interno.html) e os
// blocos que o notifier usa. O HTML e o mesmo da folha: so o idioma (lang) e o selo "Aviso interno" viraram
// placeholders, porque o app fala portugues e ingles. Tudo que vem de fora (nome da rotina, erro, URL) e escapado
// aqui. Marca SyntaxLab, com os logos publicados em syntaxlab.com.br: o app roda local, entao nada de anexo.

const LAYOUT = `<!doctype html>
<html lang="{{lang}}" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no, date=no, address=no, email=no, url=no">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light only">
<title>{{assunto}}</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
<!--[if mso]><style>body,table,td,p,a,h1,span{font-family:Arial,Helvetica,sans-serif !important;}</style><![endif]-->
<style>
/* Layout base AVISO INTERNO (para o Thales). Mais denso que o de cliente:
   campos em tabela, respostas em bloco, rodapé SyntaxLab compacto.
   Funciona sem este bloco; ele só ajusta o celular. Namespaces:
   em-shell, em-card, em-btn, em-foot, em-fields. */
:root { color-scheme: light only; supported-color-schemes: light only; }
body { margin: 0; padding: 0; -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
a[x-apple-data-detectors] { color: inherit !important; text-decoration: none !important; }
@media only screen and (max-width: 620px) {
  .em-shell__outer { padding: 16px 10px 24px !important; }
  .em-card__pad { padding-left: 22px !important; padding-right: 22px !important; }
  .em-card__head { padding-left: 14px !important; }
  .em-card__title { font-size: 21px !important; line-height: 28px !important; }
  .em-btn { width: 100% !important; }
  .em-btn__cell { display: block !important; width: 100% !important; }
  .em-btn__link { display: block !important; text-align: center !important; }
  .em-fields__label { display: block !important; width: 100% !important; padding-bottom: 0 !important; border-bottom: 0 !important; }
  .em-fields__value { display: block !important; width: 100% !important; padding-top: 2px !important; border-top: 0 !important; }
  .em-foot__col { display: block !important; width: 100% !important; text-align: left !important; }
  .em-foot__contact { padding: 6px 0 0 8px !important; }
}
</style>
</head>
<body style="margin:0;padding:0;background-color:#f2f2ef;">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#f2f2ef;">{{preheader}}{{preheader_filler}}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f2f2ef" style="background-color:#f2f2ef;">
<tr>
<td align="center" class="em-shell__outer" style="padding:32px 16px 40px;">
<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" align="center"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;">
<tr>
<td bgcolor="#ffffff" style="background-color:#ffffff;border:1px solid #e4e3de;border-radius:14px;overflow:hidden;box-shadow:0 1px 2px rgba(20,20,18,.04),0 10px 26px rgba(20,20,18,.05);">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
<tr><td height="3" bgcolor="{{acento}}" style="height:3px;line-height:3px;font-size:0;background-color:{{acento}};border-radius:14px 14px 0 0;">&nbsp;</td></tr>
<tr>
<td class="em-card__pad em-card__head" style="padding:24px 36px 0 28px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
<tr>
<td valign="middle">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="#ffffff" style="padding:8px;border-radius:8px;background-color:#ffffff;background-image:linear-gradient(#ffffff,#ffffff);"><img src="{{logo_src}}" width="{{logo_largura}}" height="{{logo_altura}}" alt="{{logo_alt}}" style="display:block;width:{{logo_largura}}px;max-width:100%;height:auto;border:0;outline:none;font-family:{{fonte}};font-size:15px;font-weight:700;color:#151514;"></td></tr></table>
</td>
<td valign="middle" align="right" style="padding-left:12px;">
<span style="display:inline-block;padding:5px 10px;border:1px solid #e4e3de;border-radius:999px;font-family:{{fonte}};font-size:10px;line-height:12px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;color:#6d6d68;white-space:nowrap;">{{aviso_interno}}</span>
</td>
</tr>
</table>
</td>
</tr>
{{corpo}}
<tr><td class="em-card__pad" style="padding:28px 36px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td height="1" style="height:1px;line-height:1px;font-size:0;border-top:1px solid #ecebe6;">&nbsp;</td></tr></table></td></tr>
<tr>
<td class="em-card__pad em-card__head" style="padding:16px 36px 22px 28px;">
{{assinatura_syntaxlab}}
</td>
</tr>
</table>
</td>
</tr>
<tr>
<td align="center" style="padding:18px 24px 0;font-family:{{fonte}};font-size:12px;line-height:18px;color:#66665f;">
{{rodape_legal}}
</td>
</tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td>
</tr>
</table>
</body>
</html>
`;

export const MAIL_FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const MONO = "SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace";
const INK = "#151514";
const TEXT = "#3b3b38";
const MUTED = "#6d6d68";
const LINE = "#ecebe6";
const BOX = "#f7f7f4";
const PREHEADER_FILLER = "&#847;&zwnj;&nbsp;".repeat(70);
const STATUS = { error: ["#fdecea", "#b42318"], neutral: ["#f0efea", "#55554f"] } as const;

/** SyntaxLab no marcas.json da folha; no aviso interno o logo sai a 78% (168 px vira 131). */
const BRAND = {
  name: "SyntaxLab",
  accent: "#1283c4",
  buttonBackground: "#0d0d0d",
  buttonText: "#ffffff",
  logoUrl: "https://syntaxlab.com.br/images/email/logo-syntaxlab.png",
  logoWidth: 131,
  logoHeight: 21,
  contact: "contato@syntaxlab.com.br",
  site: "https://syntaxlab.com.br"
} as const;

export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

/** "e-mail" nunca quebra no hifen no celular. */
function noBreak(html: string): string {
  return html.replace(/(e-mail|E-mail)/g, '<span style="white-space:nowrap;">$1</span>');
}

function row(content: string, top: number): string {
  return `<tr><td class="em-card__pad" style="padding:${top}px 36px 0px;">${content}</td></tr>`;
}

/** Linhas do corpo do cartao, no mesmo HTML da folha. Recebem texto puro e escapam. */
export const block = {
  status(text: string, kind: keyof typeof STATUS): string {
    const [background, color] = STATUS[kind];
    return row(
      `<span style="display:inline-block;padding:5px 11px;border-radius:999px;background-color:${background};font-family:${MAIL_FONT};font-size:11px;line-height:14px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:${color};">${escapeHtml(text)}</span>`,
      26
    );
  },
  title(text: string): string {
    return row(
      `<h1 class="em-card__title" style="margin:0;font-family:${MAIL_FONT};font-size:23px;line-height:30px;font-weight:700;letter-spacing:-0.4px;color:${INK};">${escapeHtml(text)}</h1>`,
      12
    );
  },
  paragraph(text: string): string {
    return row(`<p style="margin:0;font-family:${MAIL_FONT};font-size:15px;line-height:24px;color:${TEXT};">${noBreak(escapeHtml(text))}</p>`, 16);
  },
  fields(rows: [string, string][]): string {
    const body = rows
      .map(([label, value], i) => {
        const border = i ? `border-top:1px solid ${LINE};` : "";
        return (
          `<tr><td class="em-fields__label" width="34%" valign="top" style="width:34%;padding:10px 14px 10px 0;${border}font-family:${MAIL_FONT};font-size:13px;line-height:20px;color:${MUTED};">${escapeHtml(label)}</td>` +
          `<td class="em-fields__value" valign="top" style="padding:10px 0;${border}font-family:${MAIL_FONT};font-size:15px;line-height:20px;font-weight:600;color:${INK};word-break:break-word;">${escapeHtml(value)}</td></tr>`
        );
      })
      .join("");
    return row(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${body}</table>`, 22);
  },
  /** Caixa com titulo e texto em fonte mono, quebras de linha preservadas (saida de erro). */
  code(title: string, text: string): string {
    const heading = `<p style="margin:0 0 8px;font-family:${MAIL_FONT};font-size:12px;line-height:16px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:${MUTED};">${escapeHtml(title)}</p>`;
    const content = `<div style="font-family:${MONO};font-size:13px;line-height:20px;color:${INK};white-space:pre-wrap;word-break:break-word;">${escapeHtml(text)}</div>`;
    return row(
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="${BOX}" style="padding:20px 22px;background-color:${BOX};border:1px solid ${LINE};border-radius:12px;">${heading}${content}</td></tr></table>`,
      22
    );
  },
  button(label: string, url: string): string {
    return row(
      `<table class="em-btn" role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>` +
        `<td class="em-btn__cell" align="center" bgcolor="${BRAND.buttonBackground}" style="border-radius:10px;background-color:${BRAND.buttonBackground};mso-padding-alt:15px 28px;">` +
        `<a class="em-btn__link" href="${escapeHtml(url)}" target="_blank" style="display:inline-block;padding:15px 28px;font-family:${MAIL_FONT};font-size:16px;line-height:20px;font-weight:700;color:${BRAND.buttonText};text-decoration:none;border-radius:10px;mso-padding-alt:0;">${escapeHtml(label)}</a>` +
        `</td></tr></table>`,
      24
    );
  }
};

function signature(tagline: string): string {
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>` +
    `<td class="em-foot__col" valign="middle" width="130" style="width:130px;">` +
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>` +
    `<td bgcolor="#ffffff" style="padding:8px;border-radius:8px;background-color:#ffffff;background-image:linear-gradient(#ffffff,#ffffff);">` +
    `<a href="${BRAND.site}" target="_blank" style="text-decoration:none;">` +
    `<img src="${BRAND.logoUrl}" width="96" height="15" alt="${BRAND.name}" style="display:block;width:96px;max-width:100%;height:auto;border:0;outline:none;text-decoration:none;font-family:${MAIL_FONT};font-size:14px;font-weight:700;color:${INK};">` +
    `</a></td></tr></table></td>` +
    `<td class="em-foot__col em-foot__contact" valign="middle" align="right" style="text-align:right;font-family:${MAIL_FONT};font-size:12px;line-height:18px;color:${MUTED};">` +
    `${escapeHtml(tagline)}<br><a href="mailto:${BRAND.contact}" style="color:${MUTED};text-decoration:none;">${BRAND.contact}</a></td>` +
    `</tr></table>`
  );
}

export interface InternalMailInput {
  lang: string;
  subject: string;
  preheader: string;
  /** Selo do cabecalho ("Aviso interno"). */
  badge: string;
  /** Linha da assinatura ("Software sob medida"). */
  tagline: string;
  footer: string;
  /** Linhas do corpo, montadas com `block`. */
  blocks: string[];
}

/** HTML completo do aviso interno. Troca numa passada so: nome de rotina com {{...}} nao vira placeholder. */
export function renderInternalMail(input: InternalMailInput): string {
  const values: Record<string, string> = {
    lang: escapeHtml(input.lang),
    assunto: escapeHtml(input.subject),
    preheader: escapeHtml(input.preheader),
    preheader_filler: PREHEADER_FILLER,
    acento: BRAND.accent,
    logo_src: BRAND.logoUrl,
    logo_largura: String(BRAND.logoWidth),
    logo_altura: String(BRAND.logoHeight),
    logo_alt: BRAND.name,
    fonte: MAIL_FONT,
    aviso_interno: escapeHtml(input.badge),
    corpo: input.blocks.join("\n"),
    assinatura_syntaxlab: signature(input.tagline),
    rodape_legal: escapeHtml(input.footer)
  };
  return LAYOUT.replace(/\{\{(\w+)\}\}/g, (match, key: string) => values[key] ?? match);
}
