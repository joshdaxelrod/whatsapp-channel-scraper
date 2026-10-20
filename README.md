# WhatsApp Channel Scraper

Collect the posts from a WhatsApp channel, along with how people reacted
to them: the total number of reactions and the count for each emoji.

## Why this exists

WhatsApp channels are public, one-way broadcast feeds, similar to Telegram
channels. Police forces, governments and news outlets increasingly use them
to post updates.

Followers can't reply, only react with an emoji, so those reactions are
one of the few public signs of how a channel's audience responds. But
WhatsApp only shows them one post at a time, and you have to click each
reaction bubble to see the breakdown.

I built this for a story on the AfD's knife-crime map, MesserHauptstadt. I
wanted to know how followers of the Berlin police channel reacted to crime
news, and specifically how often they used the plane emoji, a symbol tied
to the AfD's calls to deport migrants. This tool collected 97 posts and
every reaction on them. That analysis is in my
[MesserHauptstadt walkthrough](https://github.com/joshdaxelrod/messerhauptstadt).

## Before you start

This tool works by controlling a Chrome window that's logged into your own
WhatsApp account. WhatsApp's terms don't allow automated access, and it can
suspend accounts it suspects of scraping. The default pauses are
deliberately long to keep that risk low, so don't shorten them.

## What you get

A spreadsheet (CSV) with one row per post:

| column | what it is |
|---|---|
| `date`, `time` | when the post went up, in your computer's time zone and date format |
| `message` | the post's text (first 500 characters) |
| `total_reactions` | all emoji reactions on the post |
| `quick_summary` | the emojis WhatsApp shows on the reaction button |
| `full_breakdown` | every emoji and its count, e.g. `✈️:213\|😡:163\|😮:75` |

## Requirements

- A Mac, Windows or Linux computer with Google Chrome installed.
- Node.js, a free program that runs the script. Download the "LTS"
  version from [nodejs.org](https://nodejs.org) and install it like any
  other app. To check it worked, open Terminal (on a Mac: press `⌘ Space`,
  type "Terminal," press Return) and run:

  ```bash
  node --version
  ```

- A WhatsApp account on your phone (see above), with WhatsApp set to
  English. The scraper reads English labels on the page.

## Install

1. Click the green **Code** button on this page, then **Download ZIP**,
   and double-click the file in your Downloads folder to unzip it.
2. In Terminal, move into the folder and install the two small libraries
   the script needs:

   ```bash
   cd ~/Downloads/whatsapp-channel-scraper-main
   npm install
   ```

   On Windows, use Command Prompt instead of Terminal, and
   `cd %USERPROFILE%\Downloads\whatsapp-channel-scraper-main`.

The scraper finds Chrome in its usual place on its own. If you installed it
somewhere else, open `scraper.js` and set `CHROME_PATH_OVERRIDE` near the
top.

## Use

Run it with the channel's name, exactly as it appears in WhatsApp:

```bash
node scraper.js "Polizei Berlin"
```

The first time, a Chrome window opens on WhatsApp Web with a QR code. On
your phone, open WhatsApp → Settings → Linked devices → Link a device, and
scan it within about a minute. If you miss it, the scraper stops; just
run it again. You only need to do this once: the login is saved in a
`chrome-profile` folder inside the scraper's folder.

The scraper then opens the channel and works backward through its
history, clicking each reaction bubble to read the full breakdown. It
saves its progress every 20 posts to `polizei_berlin_reactions.csv`
(named after the channel).

It can be finicky. It works by scrolling and clicking through WhatsApp Web
the way a person would, and WhatsApp Web only loads the posts near where
you're scrolled, so a pass can skip posts or stall. Keep an eye on the
Chrome window while it runs, but don't click in it. Expect to run it
several times to get everything: each run picks up where the last left off
and never saves the same post twice. To start over on a channel, delete
its results file and the matching `_scraped_ids.json` file next to it.

## Limitations

- WhatsApp Web only shows a few months of a channel's history, however far
  back you scroll.
- Posts with no reactions have an empty breakdown.
- Excel on Windows can garble emojis in the results. Google Sheets and
  Numbers show them correctly.
- Reactions are anonymous, so there's no way to see who reacted.
- If the scraper can't open a post's reaction breakdown, it saves the post
  with an empty breakdown, and later runs won't go back for it.
- WhatsApp changes its web app regularly, which can break the scraper. If
  it stops finding posts or reactions, that's the likely cause.

## License

MIT — see [LICENSE](LICENSE).

Built with AI assistance (Claude Opus 5.5), reviewed and tested by me.

## About

Written by [Josh Axelrod](https://josh-axelrod.com), an investigative
reporter and 2023–24 Fulbright Journalism Fellow based in Berlin,
Germany. He covers extremism, disinformation, and technology; his work
has appeared in WIRED, Mother Jones, Deutsche Welle, Die Zeit, The Daily
Beast, NPR, and more.
