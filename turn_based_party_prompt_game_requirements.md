# Turn-Based Party Prompt Game Requirements

## 1. App Overview

Build a mobile-first web app inspired by the social prompt-and-vote structure of party games like Quiplash, but designed for asynchronous turn-based play similar to Words with Friends.

Players join a game using a short room code, answer funny family-friendly prompts, vote on responses, and progress through three rounds without needing everyone online at the same time.

The app should use:

- **Frontend:** Simple HTML/CSS/JavaScript
- **Backend/database:** Supabase
- **Authentication:** Supabase Auth
- **Prompt source:** Fixed database of 100 family-friendly prompts

---

## 2. Core Goals

The app should allow users to:

- Create an account and log in
- Start a new game
- Join an existing game using a short room code
- Play asynchronously across multiple days
- Check whether it is their turn
- Submit funny answers to prompts
- Vote on other players’ answers
- View current game status
- View previous games they participated in
- View player stats and game history
- Play safely with family-friendly prompts and profanity blocking

---

## 3. Player Rules

| Rule | Requirement |
|---|---|
| Maximum players | 8 |
| Minimum players | Recommended 3 |
| Accounts | Required login through Supabase Auth |
| Display name | User chooses a public nickname |
| Game access | Only players in a game can view that game |
| Room code | Short generated room code, such as `A7K9Q2` |

---

## 4. Game Structure

The game has **3 rounds**.

### Round 1

- Each player receives 2 prompts.
- Players submit one answer per prompt.
- Once all answers are submitted, the game moves to voting.
- Players vote on responses.
- Voting remains open until:
  - All eligible players have voted, or
  - 24 hours have passed.

### Round 2

- Same structure as Round 1.
- Each player receives 2 prompts.
- Scores may use higher point values than Round 1.

### Round 3 Finale

- Each player receives 1 finale prompt.
- Each player submits a collection of **3 words**.
- Voting awards points for:
  - Best overall collection of 3 words
  - Best individual word

---

## 5. Game Flow

### Full Game Phase Flow

```text
Lobby
↓
Round 1 Answering
↓
Round 1 Voting
↓
Round 1 Results
↓
Round 2 Answering
↓
Round 2 Voting
↓
Round 2 Results
↓
Round 3 Finale Answering
↓
Round 3 Finale Voting
↓
Final Results
↓
Game Complete
```

---

## 6. Turn-Based / Async Behavior

The app does not require all players to be online together.

Players should be able to open the app and immediately see:

- Games where it is their turn
- Games waiting on other players
- Games in voting
- Games with new results available
- Completed games

### Manual Check Only

No push notifications are required for MVP.

### Reminder Logic

Instead of strict turn timers, the app should show friendly reminders such as:

- “Waiting on 2 players”
- “Voting closes in 8 hours”
- “This round has been waiting for 2 days”
- “You still need to answer 1 prompt”

---

## 7. 24-Hour Voting Rule

Voting phases should remain open until either:

1. All eligible players have voted, or
2. 24 hours have passed since voting opened.

When 24 hours pass:

- The game automatically advances using the votes that were submitted.
- Missing votes are ignored.
- Players who did not vote receive no voting bonus, if such a bonus exists.
- Host may also force advance earlier if needed.

---

## 8. Missing Player Logic

Recommended behavior:

| Situation | Behavior |
|---|---|
| Player does not submit answer | Their answer is treated as missing |
| Player has no answer in a matchup | Opponent may win by default |
| Player does not vote | Their vote is ignored after 24 hours |
| Player abandons game | Host can remove player or force advance |
| Removed player | Their future prompts/votes are skipped |

This keeps the game moving without punishing active players too much.

---

## 9. Scoring Rules

### Round 1 Suggested Scoring

| Vote Result | Points |
|---|---:|
| Each vote received | 100 |
| Winning answer bonus | 250 |
| Tie | Both tied players receive winner bonus |

### Round 2 Suggested Scoring

| Vote Result | Points |
|---|---:|
| Each vote received | 200 |
| Winning answer bonus | 500 |
| Tie | Both tied players receive winner bonus |

### Round 3 Finale Suggested Scoring

| Vote Type | Points |
|---|---:|
| Vote for best full 3-word collection | 600 |
| Vote for best individual word | 200 |
| Most overall collection votes bonus | 800 |
| Most individual word votes bonus | 300 |

### Tie Handling

If multiple players tie for a winning bonus:

- All tied players receive the full bonus.
- No tiebreaker is needed.
- This keeps the game fun and avoids overcomplicated rules.

---

## 10. Voting Rules

### Standard Rounds

Players vote between submitted answers for each prompt.

Rules:

- A player cannot vote for their own answer.
- Players can change their vote until the voting phase closes.
- Voting closes when everyone votes or after 24 hours.
- Missing answers are skipped.
- If only one valid answer exists, that answer may win by default.

### Finale Voting

Players vote on:

1. Best overall set of three words
2. Best individual word from all submitted words

Rules:

- Players cannot vote for their own collection.
- Players cannot vote for their own individual words.
- Votes can be changed until the finale voting phase closes.
- Voting closes after all votes are submitted or 24 hours pass.

---

## 11. Prompt Requirements

The app should include exactly **100 fixed prompts** for MVP.

### Prompt Mix

| Prompt Type | Count |
|---|---:|
| Open-ended question prompts | 50 |
| Fill-in-the-blank prompts | 50 |

### Prompt Guidelines

Prompts must be:

- Family-friendly
- Funny but not mean-spirited
- Simple to understand
- Short enough for mobile screens
- Flexible enough for creative answers
- Free of profanity, adult content, political attacks, hateful content, or targeted insults

### Example Open-Ended Prompts

- What is the worst thing to bring on an airplane?
- What is one thing you should always bring to the beach?
- What would be a terrible name for a superhero?
- What is something you should never say at a wedding?
- What would make a terrible pizza topping?

### Example Fill-in-the-Blank Prompts

- The worst school subject would be Advanced ______.
- My new invention is a machine that automatically ______.
- The rejected theme for the school dance was ______.
- The worst prize in a cereal box would be ______.
- The name of my imaginary pet dragon is ______.

---

## 12. Profanity and Safety Rules

The app should block profanity before answer submission.

### Requirements

- Do not allow cuss words.
- Do allow emojis.
- Do allow punctuation and special characters.
- Show a friendly error message when blocked.
- Do not permanently save blocked answers.

### Suggested Error Message

> Keep it family-friendly 🙂 Try another answer.

### Safety Filter Categories

Block or reject answers containing:

- Profanity
- Slurs
- Explicit sexual content
- Graphic violence
- Hate speech
- Harassment targeted at real people
- Personal information such as phone numbers or addresses

---

## 13. Host Powers

The game creator is the host.

The host can:

- Start the game
- Remove players from the lobby
- Remove inactive players during the game
- Force advance to the next phase
- End the game early
- View current waiting status

Host actions should be logged for transparency.

---

## 14. Game History

Completed games should remain viewable.

Access rules:

- Only users who participated in a game can view that game.
- Game history should include:
  - Final scores
  - Round-by-round scores
  - Prompts
  - Answers
  - Vote counts
  - Winner
  - Date completed
  - Player list

---

## 15. Stats Requirements

The app should track as many stats as practical.

### Player Stats

| Stat | Description |
|---|---|
| Games played | Total games joined |
| Games completed | Total games finished |
| Wins | Number of first-place finishes |
| Win rate | Wins divided by completed games |
| Total points | Lifetime points |
| Average score | Average final score |
| Highest score | Best single-game score |
| Total votes received | All votes received |
| Average votes per answer | Votes divided by submitted answers |
| Funniest answer count | Number of prompt wins |
| Finale wins | Number of finale wins |
| Perfect rounds | Rounds where every answer won |
| Voting participation | Percent of voting phases completed |
| Favorite opponent | Most-played-with player |
| Recent games | Last several completed games |

### Game Stats

| Stat | Description |
|---|---|
| Total players | Number of players in game |
| Total answers | Number of submitted answers |
| Total votes | Number of votes cast |
| Missing answers | Number of skipped/missing answers |
| Missing votes | Number of players who did not vote |
| Round winners | Winner by round |
| Final winner | Overall winner |
| Closest margin | Difference between first and second |
| Biggest answer win | Answer with most votes |

---

## 16. Mobile-First UI Requirements

The app should be designed for phones first.

### Main Screens

| Screen | Purpose |
|---|---|
| Login | Sign in or create account |
| Home Dashboard | Show active games and available actions |
| Create Game | Start a new game |
| Join Game | Enter room code |
| Lobby | Waiting room before game starts |
| Answer Prompt | Submit answers |
| Voting | Vote on responses |
| Round Results | Show round outcome |
| Final Results | Show winner and full game recap |
| Stats | Show user stats |
| Game History | View completed games |

### Design Requirements

- Large touch-friendly buttons
- Simple card-based layout
- Minimal typing
- Clear “your turn” indicators
- Progress tracker for round and phase
- Responsive layout for desktop
- Friendly tone and playful visual style

---

## 17. Suggested Supabase Tables

### `profiles`

Stores public user profile info.

| Column | Type | Notes |
|---|---|---|
| id | uuid | Matches Supabase auth user id |
| nickname | text | Public display name |
| created_at | timestamptz | Created timestamp |

---

### `games`

Stores each game.

| Column | Type | Notes |
|---|---|---|
| id | uuid | Primary key |
| room_code | text | Short join code |
| host_user_id | uuid | User who created game |
| status | text | lobby, active, completed, ended |
| current_round | int | 1, 2, or 3 |
| current_phase | text | lobby, answering, voting, results, complete |
| voting_started_at | timestamptz | Used for 24-hour voting deadline |
| created_at | timestamptz | Created timestamp |
| completed_at | timestamptz | Completed timestamp |

---

### `game_players`

Stores players in each game.

| Column | Type | Notes |
|---|---|---|
| id | uuid | Primary key |
| game_id | uuid | Related game |
| user_id | uuid | Related user |
| nickname_snapshot | text | Nickname at time of game |
| role | text | host or player |
| status | text | active, removed, left |
| score | int | Current score |
| joined_at | timestamptz | Join timestamp |

---

### `prompts`

Stores fixed prompts.

| Column | Type | Notes |
|---|---|---|
| id | uuid | Primary key |
| prompt_text | text | Prompt text |
| prompt_type | text | open_ended, fill_blank, finale |
| family_safe | boolean | Should always be true |
| active | boolean | Whether prompt is available |

---

### `round_prompts`

Stores which prompts were assigned in each game.

| Column | Type | Notes |
|---|---|---|
| id | uuid | Primary key |
| game_id | uuid | Related game |
| round_number | int | 1, 2, or 3 |
| prompt_id | uuid | Related prompt |
| assigned_group | int | Matchup/group number |

---

### `answers`

Stores submitted answers.

| Column | Type | Notes |
|---|---|---|
| id | uuid | Primary key |
| game_id | uuid | Related game |
| round_prompt_id | uuid | Related assigned prompt |
| user_id | uuid | Answering user |
| answer_text | text | Submitted answer |
| word_1 | text | Finale only |
| word_2 | text | Finale only |
| word_3 | text | Finale only |
| submitted_at | timestamptz | Submit timestamp |

---

### `votes`

Stores votes.

| Column | Type | Notes |
|---|---|---|
| id | uuid | Primary key |
| game_id | uuid | Related game |
| round_prompt_id | uuid | Related prompt |
| voter_user_id | uuid | Voting user |
| answer_id | uuid | Selected answer |
| vote_type | text | standard, finale_collection, finale_word |
| selected_word | text | Finale individual word vote |
| created_at | timestamptz | Created timestamp |
| updated_at | timestamptz | Updated when vote changes |

---

### `game_events`

Stores audit log events.

| Column | Type | Notes |
|---|---|---|
| id | uuid | Primary key |
| game_id | uuid | Related game |
| actor_user_id | uuid | User who caused event |
| event_type | text | start, force_advance, remove_player, end_game |
| event_details | jsonb | Extra info |
| created_at | timestamptz | Created timestamp |

---

## 18. Supabase Security Requirements

Use Row Level Security.

### Access Rules

| Table | Rule |
|---|---|
| profiles | Users can read basic profile info for players in their games |
| games | Users can read games they are in |
| game_players | Users can read players for games they are in |
| prompts | Authenticated users can read active prompts |
| answers | Users can read answers only after voting phase starts |
| votes | Users can insert/update their own votes |
| game_events | Users can read events for games they are in |
| host actions | Only host can remove players, force advance, or end game |

---

## 19. MVP Features

### Must Have

- Supabase Auth login
- Profile nickname setup
- Create game
- Join game by room code
- Lobby screen
- Maximum 8 players
- Host starts game
- Round 1 answering
- Round 1 voting
- Round 2 answering
- Round 2 voting
- Finale answering
- Finale voting
- Scoring
- Final results
- Game history for participants
- Basic player stats
- Profanity blocking
- 100 fixed prompts
- Mobile-first layout

### Nice to Have Later

- Email reminders
- Push notifications
- Custom prompt packs
- AI-generated prompts
- Friend lists
- Rematch button
- Chat/reactions
- Avatars
- Achievements
- Public leaderboard
- Dark mode
- Admin prompt editor

---

## 20. Recommended Build Order

1. Create Supabase project
2. Set up Auth
3. Create database tables
4. Add RLS policies
5. Seed 100 prompts
6. Build login screen
7. Build dashboard
8. Build create/join game flow
9. Build lobby
10. Build answer submission
11. Build voting
12. Build phase advancement
13. Build scoring
14. Build results
15. Build stats/history
16. Polish mobile UI
17. Test with 3–8 players

---

## 21. Open Implementation Decisions

These can be decided during development:

| Decision | Recommended Default |
|---|---|
| Room code length | 6 characters |
| Minimum players to start | 3 |
| Answer max length | 80 characters |
| Finale word max length | 20 characters each |
| Voting duration | 24 hours |
| Prompt reuse in same game | Avoid reuse |
| Profanity behavior | Block submission |
| Tie behavior | Full points to all tied winners |
| Removed player history | Keep past answers/votes, skip future turns |

---

## 22. Success Criteria

The app is successful when:

- 3–8 logged-in users can join a room.
- The host can start the game.
- Players can answer prompts asynchronously.
- Players can vote and change votes before voting closes.
- Voting auto-advances after 24 hours.
- Scores calculate correctly.
- Finale scoring includes both collection and individual word voting.
- Completed games remain visible only to participants.
- Stats update after completed games.
- Profanity is blocked before answers are saved.
- The app is comfortable to use on a phone.
