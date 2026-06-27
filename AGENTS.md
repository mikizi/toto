# Analytics Tracking - Mixpanel

This project uses Mixpanel for product analytics. Do not introduce another analytics SDK unless the user explicitly asks for it.

## Tech Stack

| Detail | Value |
|---|---|
| Platform | Static web app, vanilla browser JavaScript, GitHub Pages-style public assets |
| Mixpanel SDK | Browser JavaScript SDK loaded by `public/js/analytics.js` from `https://cdn.mxpnl.com/libs/mixpanel-2-latest.min.js` |
| Tracking method | Client-side |
| CDP | None found |
| Consent required | No EU/California gate configured; user confirmed audience is Israel only |
| Project token location | `public/js/analytics.js` (`MIXPANEL_TOKEN`) |
| Mixpanel ingest host | `https://api-eu.mixpanel.com` |

## Initialization

Mixpanel initializes once in `public/js/analytics.js`. The helper creates the Mixpanel queue/stub, calls `mixpanel.init(...)`, then loads the Mixpanel browser SDK. The project uses Mixpanel EU ingest (`api_host: "https://api-eu.mixpanel.com"`), matching the setup snippet supplied from Mixpanel.

- `public/index.html`
- `public/player.html`
- `public/admin/index.html`

Feature files should call `window.totoAnalytics.track(...)` or `window.totoAnalytics.trackPage(...)`. Do not call `mixpanel.track(...)` directly from feature code.

## Identity

There is no public user login flow. Public visitors are identified in Mixpanel with the anonymous `wc26-presence-id` so Mixpanel user profiles populate for visitor analysis. The same `wc26-presence-id` is also added as a non-PII super property for live-traffic analysis.

The admin page uses a shared password, so it must not identify admins as a shared static user. It may still use the anonymous visitor profile ID from `wc26-presence-id`.

## Current Tracking Plan

| Event | Trigger | Key Properties | File |
|---|---|---|---|
| `scoreboard_viewed` | Scoreboard/countdown data loads for the first time | `view_mode`, `games_played`, `matches_count`, `leaderboard_count`, `has_live_match`, `live_match_count`, `registration_open`, `registration_count`, `prize_pool` | `public/js/app.js` |
| `scoreboard_refreshed` | User clicks refresh and fresh data loads | Same as `scoreboard_viewed`, plus `load_source` | `public/js/app.js` |
| `live_update_received` | Polling detects a new scoreboard version | `previous_games_played`, `previous_version`, `next_version`, plus scoreboard state | `public/js/app.js` |
| `standings_toggled` | User expands or collapses standings | `is_expanded`, `visible_rows`, `leaderboard_count`, `games_played` | `public/js/app.js` |
| `fixtures_toggled` | User expands or collapses fixtures | `is_expanded`, `matches_count`, `games_played` | `public/js/app.js` |
| `player_profile_opened` | User clicks a leaderboard row | `source`, `rank`, `points`, `has_champion_pick`, `games_played` | `public/js/app.js` |
| `player_profile_viewed` | Player page loads successfully | `player_id`, `player_name`, `rank`, `points`, `champion_pick`, `picks_count`, `games_played`, `matches_count`, `lookup_method` | `public/js/player-page.js` |
| `player_profile_missing` | Player page cannot find the requested player | `lookup_method` | `public/js/player-page.js` |
| `player_profile_load_failed` | Player page data request fails | `error_message` | `public/js/player-page.js` |
| `music_player_controlled` | User controls the music player or a track ends | `action`, `track_index`, `track_title`, `is_paused` | `public/js/player.js` |
| `admin_signed_in` | Admin password is submitted locally or in production | `surface`, `admin_mode`, `active_admin_tab` | `public/admin/admin.js` |
| `admin_signed_out` | Admin logs out | `surface`, `admin_mode`, `active_admin_tab` | `public/admin/admin.js` |
| `admin_tab_changed` | Admin switches tabs | `tab_name` | `public/admin/admin.js` |
| `admin_match_selected` | Admin selects a match card | `match_id`, `home_team`, `away_team`, `is_played` | `public/admin/admin.js` |
| `match_result_published` | Local API or worker accepts a result publish | `match_id`, `home_team`, `away_team`, `home_score`, `away_score`, `admin_mode` | `public/admin/admin.js` |
| `match_score_restored` | Local API or worker accepts score restore | `match_id`, `home_team`, `away_team`, `admin_mode` | `public/admin/admin.js` |
| `match_live_changed` | Live broadcast match IDs are updated | `live_match_ids`, `live_match_count`, `admin_mode` | `public/admin/admin.js` |
| `autopilot_changed` | Admin changes autopilot | `is_enabled`, `admin_mode` | `public/admin/admin.js` |
| `registration_saved` | Local API or worker accepts registration update | `player_count`, `prize_pool`, `save_mode` | `public/admin/admin.js` |
| `workbook_downloaded` | Workbook download succeeds | `admin_mode` | `public/admin/admin.js` |
| `workbook_uploaded` | Workbook upload succeeds | `file_size_bytes`, `admin_mode` | `public/admin/admin.js` |
| `knockout_round_changed` | User swipes to a knockout round on the main or player page | `round_id`, `round_label`, `round_index`, `source` | `public/js/app.js`, `public/js/player-page.js` |
| `rules_panel_viewed` | User swipes to the rules/prizes panel | `source`, `games_played` | `public/js/app.js` |
| `knockout_fixture_locked` | Admin locks a knockout fixture team pairing | `match_id`, `home_team`, `away_team`, `winner` | `public/admin/admin.js` |
| `knockout_live_changed` | Admin starts, updates, or stops a knockout live score | `match_id`, `home_team`, `away_team`, `winner` | `public/admin/admin.js` |
| `knockout_winner_confirmed` | Admin confirms the advancing knockout team | `match_id`, `home_team`, `away_team`, `winner` | `public/admin/admin.js` |

## Rules For Future Events

- Use `snake_case` event and property names.
- Track after a user action succeeds or after the UI state has actually changed.
- Do not send admin passwords, emails, phone numbers, or payment details.
- Participant display names are allowed only on `player_profile_viewed`, per user confirmation that these names are not sensitive for this site.
- Do not construct event names dynamically.
- Reuse `window.totoAnalytics` so base properties stay consistent.
- Update this file whenever adding, renaming, or removing a Mixpanel event.
