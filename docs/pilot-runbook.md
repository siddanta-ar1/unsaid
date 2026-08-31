# Pilot runbook

How to run the first cohort so that it produces an answer rather than
encouragement.

## Who to invite

**Twenty to thirty people**, drawn from a narrow behavioural wedge, not from
"anyone who feels lonely":

- People who already send themselves voice notes to think.
- People who keep a private journal, digital or paper.
- People who have used an AI chat for something they would not say to a friend.

Deliberately **not**: people who will use it because they like you. Their
retention tells you nothing, and their politeness costs you a month.

Recruit in three waves of ten. A wave that reveals a blocking problem should
stop the next one — twenty people hitting the same broken thing is nineteen
wasted invitations.

## Before the first invitation

Every line of the launch gate in the shipping plan must be true. In particular:

- [ ] The crisis resources in `backend/api/src/lib/ai/crisis.ts` have been
      **dialled by a human**. `unverifiedRegions()` returns empty.
- [ ] `./scripts/restore-drill.sh` has passed against production, on a date you
      can name.
- [ ] The privacy policy has had a Nepal-qualified review.
- [ ] Rollback is documented and someone is on call for day one.

## What to say when you invite them

Do not oversell it, and do not apologise for it either. Something close to:

> I have built a private place to say things you would rather not say out loud.
> Everything is encrypted on your device — I cannot read any of it, by design.
> I would like you to use it for two weeks and then tell me honestly whether it
> was worth opening. If it was not, that is the useful answer.

Say explicitly that **you cannot recover their vault** if they lose both the
phrase and the kit. Someone finding that out afterwards is a betrayal; someone
told up front is making a choice.

## What to measure

The funnel is at `GET /v1/signals/funnel`. Four numbers matter:

| Number | What it answers | Worrying if |
|---|---|---|
| Vault created / landed | Is the passphrase wall survivable? | Below 40% |
| First save / vault created | Did they get to the point? | Below 60% |
| Returned within 7 days | Is there a reason to come back? | Below 25% |
| Weekly meaningful releases per retained user | Is this a habit or a demo? | Below 2 |

The last one is the north star (§25.1). Signups are not a number; page views
are not a number.

## The conversations

Ten structured conversations, **including at least three people who stopped**.
The enthusiasts will tell you what to build; the people who quietly abandoned
will tell you why nobody else will use it. Only one of those is worth a month.

Use the blueprint's interview script (§4.2), and add:

1. Walk me through the last time you opened it. What was happening?
2. What did you expect to happen when you pressed the button?
3. Was there a moment you decided not to write something? What stopped you?
4. Did you believe the privacy claim? What made you believe it or not?
5. (If they used Echo) Did the response add anything, or was it noise?
6. (If they stopped) What was the last thing you remember doing in it?

Do not defend the product during these. Write down what they say, not what you
wish they had said.

## Weekly founder review

Every Friday, in writing, answer the questions from the blueprint (§27.1):

- What did users do that we did not expect?
- Where did they hesitate because of privacy or complexity?
- Did they return without a reminder?
- Did Solana add real user value, or only founder excitement?
- Which security risk moved closer to unacceptable?
- What should we delete from the roadmap?

## The decision

After four weeks, write one page that says **go, iterate, or stop**, with the
four numbers above and the quotes that support it. Write it before you look at
the numbers again, so it is a judgement rather than a rationalisation.

Retention below the thresholds is not a marketing problem. It means the core
job — safe expression — is not being done well enough yet, and no amount of
polish on the encryption changes that.
