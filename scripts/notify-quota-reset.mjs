// Sends an email notification that Cloudflare Workers AI quota has reset.
// Run: node scripts/notify-quota-reset.mjs
import { Resend } from 'resend';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dir, '../.env.local');

// Parse .env.local manually (no dotenv dependency needed)
for (const line of readFileSync(envPath, 'utf8').split('\n')) {
  const [key, ...rest] = line.split('=');
  if (key && rest.length) process.env[key.trim()] = rest.join('=').trim();
}

const resend = new Resend(process.env.RESEND_API_KEY);

const { data, error } = await resend.emails.send({
  from: 'Prism <onboarding@resend.dev>',
  to: 'disun2g@gmail.com',
  subject: 'Cloudflare quota reset — covers are back!',
  html: `
    <p>Hey! The Cloudflare Workers AI daily quota has reset.</p>
    <p>You can now test the image models for paper covers on Prism:</p>
    <ul>
      <li>Flux Schnell (default)</li>
      <li>SDXL Base</li>
      <li>SDXL Lightning</li>
      <li>Dreamshaper</li>
    </ul>
    <p>Start your dev server and open <a href="http://localhost:3000">http://localhost:3000</a>.</p>
  `,
});

if (error) {
  console.error('Failed to send:', error);
  process.exit(1);
} else {
  console.log('Email sent!', data?.id);
}
