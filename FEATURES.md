# EnvelopeAI

> **Note:** Do not write or scaffold any code until I explicitly tell you to start.

## Context

This is an AI-native YNAB alternative built for **Publik (`publikhq.com`)** and powered by the **Publik API**. 

Since AI calls go through the Publik API, we don't need users to bring their own API keys and we don't need to ration AI usage. And because nobody wants to hand over their bank login to a site they just opened, everything runs local-first in the browser (`localStorage` / `IndexedDB`) with easy CSV/JSON import and export.

The pitch is simple: **Stop paying YNAB $109/year to budget your own money.**

---

## The Two Features

### 1. Drop Anything, Get Funded Envelopes in 10 Seconds
Setting up YNAB takes two hours of making categories and learning zero-based budgeting rules. Every payday, you still have to click through 30 rows to assign your money.

Instead of starting with a blank table or a signup wall, the home screen is one input box. You either:
- Drop a bank statement (CSV, PDF, or screenshot) or a YNAB export, **or**
- Type a quick brain dump (*"I have $1,900 in checking, rent is $1,400 on the 1st, and I get paid $2,200 on Friday"*).

Within a few seconds, the AI sets up your envelopes, spots forgotten subscriptions and upcoming bills, and assigns every dollar you currently have so you know what your money needs to do before your next paycheck. You can approve the whole plan in one click or tell the AI what to move around.

### 2. "Can I Afford This?" & The Reality Receipt
Nobody opens a budget spreadsheet *before* buying something, and nobody shares budget spreadsheets online.

With this, you can type in something you're tempted to buy (*"PS5 Pro $700"* or *"Weekend in Austin $600"*)—or hit **"Roast My Statement"** right after importing. Instead of a generic yes or no, the AI tells you what that purchase actually costs in terms of your own budget:
- *"Buying this $700 PS5 Pro costs 19 Chipotle runs, takes $300 out of your Japan trip envelope, and pushes your Age of Money back 11 days."*

From there, you get two buttons:
- **Buy it anyway:** The AI automatically pulls money from your lowest-priority envelopes to cover it.
- **Save me from myself:** It moves that money straight into savings.

It also prints a shareable **Reality Receipt**—a thermal-style receipt showing your spending archetype, subscriptions caught (plus the $109/yr saved by ditching YNAB), your Age of Money, and the tradeoff math. It uses ratios and everyday items instead of showing your actual bank balance, so people can actually screenshot and post it on X, Reddit, or TikTok.
