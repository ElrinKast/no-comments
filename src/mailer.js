import nodemailer from "nodemailer";

function boolEnv(value, fallback = false) {
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function smtpConfig() {
  const port = Number(process.env.SMTP_PORT || 587);
  return {
    host: process.env.SMTP_HOST || "",
    port,
    secure: boolEnv(process.env.SMTP_SECURE, port === 465),
    user: process.env.SMTP_USER || "",
    password: process.env.SMTP_PASSWORD || "",
    from: process.env.SMTP_FROM || "Kolink <noreply@kolink.ru>"
  };
}

export function isMailerConfigured() {
  const config = smtpConfig();
  return Boolean(config.host && config.user && config.password && config.from);
}

export async function sendVerificationCode({ to, code }) {
  const config = smtpConfig();
  if (!isMailerConfigured()) {
    throw new Error("Почта для отправки кодов еще не настроена.");
  }

  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: config.user,
      pass: config.password
    }
  });

  await transporter.sendMail({
    from: config.from,
    to,
    subject: "Код подтверждения Kolink",
    text: `Ваш код подтверждения Kolink: ${code}\n\nКод действует 10 минут.`,
    html: `
      <div style="font-family:Arial,sans-serif;color:#111318">
        <h1 style="font-size:20px">Kolink</h1>
        <p>Ваш код подтверждения:</p>
        <p style="font-size:28px;font-weight:700;letter-spacing:4px">${code}</p>
        <p>Код действует 10 минут.</p>
      </div>
    `
  });
}
