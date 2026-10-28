# Prism

A daily reading room for new research.

Browse today’s papers by field, or build a personal list from the topics and people you follow. Each paper opens to its abstract, a short summary, and a link back to the source.

**Live:** [prismdailyarxiv.com](https://prismdailyarxiv.com/)

## What you can do

**arXiv.** The home page is a feed of recent papers, grouped into fields across AI, physics, biology, math, finance, and medicine. Medical fields come from PubMed. Pick a category, or a day from the last 90 days, and the list updates. The banner shows how many papers arrived and how many categories are live.

**Customized.** Describe what you work on, name a group or a few authors, and Prism searches recent arXiv papers for that profile. Find collaborators looks up frequent coauthors in OpenAlex and adds them to the list. The profile and today’s results stay in this browser. There is no account.

**On each paper.** Read the abstract, ask for a three-sentence summary (the problem, the method, and the result), or listen to it read aloud. Covers use a figure from the paper when one is available. Titles link to the arXiv abstract and PDF, or to the PubMed record.

**Request a category.** If a field is missing, name it at the bottom of the home page. Prism already knows the categories it carries and will say so.

Light and dark themes follow the toggle in the header.

## Categories

| Group | Fields |
| --- | --- |
| AI & ML | Artificial Intelligence, Machine Learning, Computer Vision, Computation & Language, Robotics, Neural & Evolutionary Computing, Information Retrieval, Statistics — Machine Learning |
| Physics | Quantum Physics, Condensed Matter, High Energy Theory, Astrophysics, Optics |
| Biology | Neurons & Cognition, Genomics, Biomolecules, Quantitative Methods |
| Medical | Oncology, Cardiology, Neurology, Infectious Disease, Immunology |
| Math | Statistics Theory, Optimization & Control, Combinatorics, Probability |
| Finance | Trading & Microstructure, Portfolio Management, Risk Management |

## Run it locally

Node.js 18 or newer.

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The paper list works with the public arXiv and PubMed APIs. Summaries, spoken audio, generated covers, and category-request email need keys in `.env.local`:

| Variable | Used for |
| --- | --- |
| `GROQ_API_KEY` | Three-sentence summaries, and the prompt behind a generated cover |
| `CF_ACCOUNT_ID`, `CF_API_TOKEN` | Spoken audio, and cover images when Cloudflare Workers AI is available |
| `POLLINATIONS_TOKEN` | Higher limit on the free cover-image fallback |
| `HF_TOKEN` | Hugging Face cover-image fallback |
| `RESEND_API_KEY` | Email for category requests |
| `CATEGORY_REQUEST_TO` | Inbox that receives those requests |
| `CATEGORY_REQUEST_FROM` | From address on those emails |

## Stack

[Next.js](https://nextjs.org/) 14, React 18, and TypeScript. Paper metadata comes from the arXiv API and NCBI E-utilities. Collaborator names come from [OpenAlex](https://openalex.org/).
