"""The ready-to-paste prompt for designing the public landing page. Built with this deployment's real URL and demo bot."""

TEMPLATE = """ROLE
You are a senior product designer and front-end engineer. Design and build a complete, deploy-ready, single-page landing page for "AI Chatbot for Websites" by __BRAND__. It must show the product convincingly and turn visitors into conversations with __BRAND__.

THE PRODUCT (use only these facts; never invent features, numbers, customers or testimonials)
- An AI chat assistant that is added to any existing website by pasting ONE line of code. A chat bubble appears on the customer's own site. Visitors are never redirected anywhere.
- It answers from the customer's own content (pasted text, web pages, PDF/text files) and, on the Premium plan, searches the web when that content has no answer.
- Customers can use their own AI keys (Claude, GPT, Llama via Groq, Grok via xAI, OpenRouter) or the included ones.
- A private dashboard to manage chatbots, knowledge, models, API keys and visitor conversations, plus full control of the chat window's look (colours, background, light or dark).
- Safe by design: API keys are encrypted; the assistant is built not to leak its instructions or dump the customer's documents; chats are deleted automatically after 90 days; it can be limited to the customer's own domains.
- Two plans, Starter and Premium. Prices are set by __BRAND__ and come from the data feed below.
- Billing is monthly and arranged directly with __BRAND__. There is no automatic charging.
- IMPORTANT, ACCESS MODEL: there is NO sign-up and no self-service registration. __BRAND__ creates every customer profile personally after the customer gets in touch (WhatsApp, email or the other channels in the feed, or the request form). Present this as a benefit: it keeps API keys and business data safe and means every account is set up properly. Never show a "Sign up" or "Start free trial" button. The only login link is a small "Customer sign-in" link for existing customers (the "app" link in the feed).

AUDIENCE
Small-business owners, agencies, freelancers and shop owners who already have a website and want instant, accurate answers for their visitors without hiring support staff. Many are not technical. Many will contact via phone or WhatsApp.

THE ONE GOAL
Get the visitor to start a conversation with __BRAND__: a contact-channel button or the "Request access" form. Every section should move toward that.

LIVE DATA (never hard-code these; fetch on page load)
GET __BASE__/api/public/site returns JSON:
{ "brand": {"name","bio","site","works":[strings]}, "headline", "subheadline",
  "contacts": [{"type","label","url"}],            // render each as a clear button; url is already safe (mailto:, https://wa.me/..., tel:, https://...)
  "plans": [{"id","label","price","features":[strings]}],   // empty price => show "Message me for pricing"
  "bar": null | offer,                              // announcement bar above the header
  "offers": [offer], "ads": [offer],
  "demo_bot": null | "bot_...",                     // public key of the live demo chatbot
  "accounts_open": false, "links": {"app","privacy","terms"} }
offer = {"id","kind","title","text","badge","price","old_price","image_url","link_url","cta_label","ends_at"}  // ends_at ISO or null
Rendering rules:
- bar: one slim line with the title and, if link_url, a link. Dismissible (remember in localStorage).
- offers: cards in a highlighted "Special offers" section placed right after the hero. Show badge, title, text, price with old_price struck through, and a call-to-action button (label cta_label or "Get this offer", link link_url or #contact). If ends_at exists show a live countdown ("Ends in 2d 04h 12m") and hide the card when it hits zero. Hide the whole section when there are no offers.
- ads: wide banner strips (optional image_url on one side, text and button on the other), placed between sections, clearly but tastefully distinct. Hide when none.
- Everything above updates without touching code when the owner edits it in the dashboard. Cache the response for 30 seconds at most.
Request form: POST __BASE__/api/public/leads with JSON {"name","contact","message","website":""}. The "website" field is a hidden honeypot: keep it empty, off-screen and tab-index -1. Show a friendly success message ("Thanks, I'll reply soon") and clear, specific error messages (429 means "too many attempts, please message me directly").
Live demo: load the real chatbot with <script src="__BASE__/widget.js" data-bot="__DEMO__" async></script> (use "demo_bot" from the feed if it is not empty; if it is empty, hide the demo button). A "Try the live demo" button should call window.AIChat.open() once the widget has loaded.

PAGE STRUCTURE (in this order)
1. Announcement bar (from "bar").
2. Header: brand name, anchor links (Features, How it works, Pricing, Contact), light/dark toggle, primary button "Get access", small "Customer sign-in" link.
3. Hero: headline and subheadline from the feed, two buttons ("Get access" scrolls to contact; "Try the live demo"), and a one-line reassurance: "No sign-up form: I set up every account personally." Beside or below it, a realistic product mock-up: a browser window with a plausible small-business website and the open chat window showing a short real-sounding conversation. Under it, the actual one-line install snippet in a code block.
4. Special offers (from "offers") and ad banners (from "ads").
5. Features (6 concise cards): one-line install, answers from your own content, web search, bring your own AI model, full dashboard and conversations, secure by design.
6. How it works (3 steps): 1 Message me, 2 I create and set up your profile, 3 Add your content and paste one line.
7. Pricing from "plans". Highlight Premium. Each card ends with the same "Get access" button. Note: billed monthly, arranged directly with me.
8. "Why there is no sign-up button": 3 short reasons (your API keys and data stay safe; I configure it for your business; you get a real person to talk to).
9. About me: brand.bio, the "works" list as portfolio links or cards, link to brand.site.
10. Contact: every contact channel as a large icon button, then the request form.
11. FAQ (details/summary): Do I need to code? Which AI models? How is my data protected? How does billing work? What happens to chats? Why no sign-up? Keep each answer to 2 sentences and only use facts above.
12. Footer: privacy and terms links from the feed, copyright, customer sign-in link.

VISUAL DIRECTION (one direction, follow it)
Confident, modern and trustworthy. Generous whitespace, large clear type, a restrained palette with a single electric-blue accent (#3355ff light, #6f86ff dark) and a warm orange reserved ONLY for offers so they stand out. Subtle grid or dot background in the hero. Rounded cards with 1px borders, soft shadows. System font stack (no web fonts) with tight, bold headings. Icons: simple inline SVG line icons, never emoji. Real UI mock-ups instead of stock illustrations. No purple-gradient clichés, no fake logos, no fake statistics.
Dark mode is required: default to the visitor's system setting, with a visible toggle that remembers the choice. Both themes must meet WCAG AA contrast.

COPY RULES
Benefit-led, concrete and short. Speak as "I" (__BRAND__ is a person/small studio, not a corporation). No hype words, no invented claims. Primary button text "Get access". Secondary: "Try the live demo". Example hero headline if the feed's headline is empty: "Add an AI assistant to any website with one line of code."

TECHNICAL REQUIREMENTS
- Deliver complete code: one index.html with linked styles.css and script.js (no frameworks, no external libraries, no web fonts, no tracking scripts). Works if hosted at a different domain than the API (the API allows cross-origin requests).
- Mobile first and fully responsive (360px to 1440px). No horizontal scroll. Tap targets at least 44px.
- Accessible: semantic landmarks, one h1, labelled form fields, visible focus, skip link, prefers-reduced-motion respected, countdown not announced every second.
- Fast: under 100 KB total, images lazy-loaded, no layout shift (reserve space for offers and ads).
- SEO: title, meta description, canonical, Open Graph and Twitter tags, JSON-LD SoftwareApplication.
- Security: build DOM with textContent (never innerHTML with feed data); only use links that start with https://, mailto:, tel: or #.
- Graceful failure: if the feed fails, still show the hero, features, how-it-works and a mailto/WhatsApp fallback message.

BEFORE YOU FINISH, CHECK
[ ] No sign-up or free-trial wording anywhere  [ ] Offers, bar, ads and contacts all come from the feed  [ ] Form works with honeypot  [ ] Demo button works  [ ] Dark mode good  [ ] Lighthouse accessibility 95+  [ ] No invented facts
"""


def build_prompt(base_url: str, brand: str, demo_bot: str) -> str:
    return (TEMPLATE.replace("__BASE__", base_url.rstrip("/")).replace("__BRAND__", brand.strip() or "the owner")
            .replace("__DEMO__", demo_bot or "(use demo_bot from the feed)"))
