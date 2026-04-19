const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');

// ── PDF text sanitizer ──────────────────────────────────────────────────────

function sanitizeForPdf(text) {
  if (!text) return '';
  return text
    .replace(/₹/g, 'INR ')
    .replace(/€/g, 'EUR ')
    .replace(/£/g, 'GBP ')
    .replace(/[\u2013\u2014\u2015]/g, '-')
    .replace(/[\u2018\u2019\u201A]/g, "'")
    .replace(/[\u201C\u201D\u201E]/g, '"')
    .replace(/[\u2039\u203A]/g, "'")
    .replace(/[\u00AB\u00BB]/g, '"')
    .replace(/\u2026/g, '...')
    .replace(/[\u00A0\u2002\u2003\u2007\u202F]/g, ' ')
    .replace(/[\u2022\u2023\u25E6\u2043]/g, '-')
    .replace(/\u2713/g, '[x]')
    .replace(/\u2717/g, '[ ]')
    .replace(/\u00D7/g, 'x')
    .replace(/\u2192/g, '->')
    .replace(/\u2190/g, '<-')
    .replace(/\u2264/g, '<=')
    .replace(/\u2265/g, '>=')
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, '');
}

// ── PDF renderer ────────────────────────────────────────────────────────────

async function renderProposalPdf({ company_name, contact_name, sections }) {
  company_name = sanitizeForPdf(company_name);
  contact_name = sanitizeForPdf(contact_name);
  sections = sections.map(s => ({
    heading: sanitizeForPdf(s.heading),
    body: sanitizeForPdf(s.body),
  }));

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const brandPrimary = rgb(0.788, 0.659, 0.298);
  const brandAccent  = rgb(0.878, 0.753, 0.416);
  const black = rgb(0.1, 0.1, 0.1);
  const gray = rgb(0.35, 0.35, 0.35);

  const cover = pdf.addPage([612, 792]);
  cover.drawRectangle({ x: 0, y: 692, width: 612, height: 100, color: brandPrimary });
  cover.drawText('Kshitiz Tiwari / The Guardians', { x: 50, y: 732, size: 22, font: fontBold, color: rgb(1, 1, 1) });
  cover.drawText('Know your regulator before your regulator knows you.', { x: 50, y: 710, size: 11, font, color: rgb(0.85, 0.85, 0.85) });
  cover.drawText('PROPOSAL', { x: 50, y: 600, size: 36, font: fontBold, color: brandPrimary });
  cover.drawText(`Prepared for ${contact_name}`, { x: 50, y: 565, size: 16, font, color: black });
  cover.drawText(company_name, { x: 50, y: 542, size: 14, font, color: gray });
  cover.drawText(new Date().toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' }), { x: 50, y: 510, size: 12, font, color: gray });

  let y = 720;
  let page = pdf.addPage([612, 792]);
  const maxWidth = 500;

  function drawLine(text, options) {
    if (y < 60) { page = pdf.addPage([612, 792]); y = 720; }
    page.drawText(text, { x: 50, y, ...options });
    y -= options.lineHeight || 18;
  }

  for (const section of sections) {
    if (y < 120) { page = pdf.addPage([612, 792]); y = 720; }
    page.drawLine({ start: { x: 50, y: y + 20 }, end: { x: 120, y: y + 20 }, thickness: 2, color: brandAccent });
    drawLine(section.heading, { size: 16, font: fontBold, color: brandPrimary, lineHeight: 28 });

    for (const paragraph of section.body.split('\n')) {
      if (paragraph.trim() === '') { y -= 10; continue; }
      const words = paragraph.split(' ');
      let line = '';
      for (const word of words) {
        const testLine = line ? `${line} ${word}` : word;
        if (font.widthOfTextAtSize(testLine, 11) > maxWidth && line) {
          drawLine(line, { size: 11, font, color: black });
          line = word;
        } else {
          line = testLine;
        }
      }
      if (line) drawLine(line, { size: 11, font, color: black });
    }
    y -= 20;
  }

  const lastPage = pdf.getPages()[pdf.getPageCount() - 1];
  lastPage.drawText('epaibbl01.kshitizt@iima.ac.in  |  The Guardians -- Regtech Advisory', { x: 50, y: 30, size: 9, font, color: gray });

  const pdfBytes = await pdf.save();
  return Buffer.from(pdfBytes).toString('base64');
}

// ── Email sender ─────────────────────────────────────────────────────────────

async function sendEmail({ to, subject, body, pdfBase64 }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { success: false, error: 'RESEND_API_KEY not configured' };

  const payload = {
    from: 'Kshitiz Tiwari <onboarding@resend.dev>',
    reply_to: 'epaibbl01.kshitizt@iima.ac.in',
    to,
    subject,
    text: body,
    ...(pdfBase64 && { attachments: [{ filename: 'proposal.pdf', content: pdfBase64 }] }),
  };

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) { console.error('Resend error:', await res.text()); return { success: false }; }
  return { success: true };
}

// ── Telegram alert ───────────────────────────────────────────────────────────

async function alertOwner(message, pdfBase64) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_USER_ID;
  if (!botToken || !chatId) return;

  await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: message }),
  });

  if (pdfBase64) {
    const formData = new FormData();
    formData.append('chat_id', chatId);
    formData.append('document', new Blob([Buffer.from(pdfBase64, 'base64')], { type: 'application/pdf' }), 'proposal.pdf');
    formData.append('caption', 'Proposal PDF');
    await fetch(`https://api.telegram.org/bot${botToken}/sendDocument`, { method: 'POST', body: formData });
  }
}

// ── Supabase lead storage ─────────────────────────────────────────────────────

async function storeLead(leadData) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_KEY;
  if (!url || !key) return;

  const res = await fetch(`${url}/rest/v1/leads`, {
    method: 'POST',
    headers: {
      'apikey': key,
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify({
      name: leadData.name || null,
      company: leadData.company || null,
      email: leadData.email || null,
      industry: leadData.industry || null,
      challenge: leadData.challenge || null,
      budget: leadData.budget || null,
      score: leadData.score || null,
      status: 'proposal_sent',
    }),
  });
  if (!res.ok) console.error('Supabase error:', await res.text());
}

// ── System prompt ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an AI writing proposals on behalf of Kshitiz Tiwari, founder of The Guardians — a regtech advisory platform for India's financial institutions.

Given visitor intake data, return a JSON object with this exact structure:
{
  "score": "HIGH" | "MEDIUM" | "LOW",
  "score_reason": "one sentence explaining the score",
  "contact_name": "visitor's name",
  "company_name": "visitor's company",
  "email": "visitor's email",
  "email_subject": "email subject line",
  "email_body": "short warm covering email (3-4 sentences plain text)",
  "sections": [
    { "heading": "section title", "body": "section content" }
  ]
}

## VOICE
1. Lead with the point. Conclusion first, context after.
2. Short sentences. No hedging. No passive voice. No filler.
3. Specificity over generality — cite product names, RBI circular names, exact constraints.
4. Never use: "Hope this finds you well", "Going forward", "Leverage" (verb), "Game-changer", "Touch base", "synergies".

## SERVICES
Service 1 — Regulatory Advisory: Map product decisions to RBI Master Directions, CICRA 2005, DPDP Act 2023. Gap analysis, audit preparation, CICRA member agreement scope review.
Service 2 — Product Consulting: Design or review bureau-integrated products for compliance and business fit. Asset-side (credit risk, underwriting) and liability-side (current account, KYC).
Service 3 — Portfolio and Underwriting Framework Design: Convert bureau signals into portfolio actions — monitor, cross-sell, or exit. Batch and real-time frameworks.

## LEAD SCORING
HIGH: right institution (SCB, NBFC, credit bureau, RBI-regulated entity) + right seniority (Head of Compliance, CRO, VP Product, CFO, MD) + live urgency (audit, DPDP gap, product launch, RBI query).
MEDIUM: two of three HIGH conditions, or softer signals.
LOW: student, researcher, non-BFSI, outside India, no specific challenge.

## PROPOSAL STRUCTURE

The "sections" array MUST contain exactly these 5 headings in this order:
1. "Understanding Your Challenge"
2. "Recommended Approach"
3. "Proposed Engagement"
4. "Investment"
5. "Next Steps"

Do not rename, merge, or skip any section. Write each body in Kshitiz's voice, specific to the visitor's situation.

Return ONLY valid JSON. No markdown, no explanation, no preamble.`;

// ── Main handler ──────────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { conversation, intakeData } = req.body;
  if (!conversation && !intakeData) return res.status(400).json({ error: 'conversation or intakeData required' });

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'OPENROUTER_API_KEY not configured' });

  const intakeContext = intakeData
    ? `VISITOR INTAKE DATA:\n${JSON.stringify(intakeData, null, 2)}`
    : `CONVERSATION TRANSCRIPT:\n${conversation.map(m => `${m.role}: ${m.content}`).join('\n')}`;

  // Single LLM call — returns structured JSON
  const llmRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://theguardians.in',
      'X-Title': 'The Guardians',
    },
    body: JSON.stringify({
      model: 'google/gemini-2.0-flash-001',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `${intakeContext}\n\nReturn the JSON proposal object.` },
      ],
      max_tokens: 2048,
    }),
  });

  if (!llmRes.ok) {
    const err = await llmRes.text();
    console.error('LLM error:', err);
    return res.status(502).json({ error: 'LLM call failed', details: err.slice(0, 200) });
  }

  const llmData = await llmRes.json();
  let raw = llmData.choices?.[0]?.message?.content || '';

  // Strip markdown code fences if present
  raw = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();

  let proposal;
  try {
    proposal = JSON.parse(raw);
  } catch (e) {
    console.error('JSON parse error:', e.message, '\nRaw:', raw.slice(0, 300));
    return res.status(502).json({ error: 'Failed to parse proposal JSON', raw: raw.slice(0, 300) });
  }

  const results = { proposal: false, email: false, stored: false, alerted: false };

  // Generate PDF
  let pdfBase64 = null;
  try {
    pdfBase64 = await renderProposalPdf({
      company_name: proposal.company_name || 'Your Organisation',
      contact_name: proposal.contact_name || 'there',
      sections: proposal.sections || [],
    });
    results.proposal = true;
  } catch (e) {
    console.error('PDF error:', e.message);
  }

  // Run email + Telegram + Supabase in parallel
  const [emailResult] = await Promise.all([
    sendEmail({
      to: proposal.email,
      subject: proposal.email_subject,
      body: proposal.email_body,
      pdfBase64,
    }),
    alertOwner(
      `NEW LEAD [${proposal.score}]\n${proposal.contact_name} — ${proposal.company_name}\nChallenge: ${proposal.sections?.[0]?.body?.slice(0, 150) || ''}\nScore reason: ${proposal.score_reason}`,
      pdfBase64
    ),
    storeLead({
      name: proposal.contact_name,
      company: proposal.company_name,
      email: proposal.email,
      challenge: proposal.sections?.[0]?.body?.slice(0, 200),
      score: proposal.score,
      status: 'proposal_sent',
    }),
  ]);

  if (emailResult?.success) results.email = true;
  results.alerted = true;
  results.stored = !!(process.env.SUPABASE_URL && process.env.SUPABASE_KEY);

  console.log('Proposal pipeline complete:', results);
  return res.json({ success: true, results, score: proposal.score });
};
