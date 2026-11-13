# Why not just ask your own assistant?

It helped you think it through, so it is checking its own work. An outside judge is not. It did not write the plan. On the chat connector and the installed tool, it does not get your assistant's memory or system instructions. On copy and paste, you choose where to paste.

When Grill can tell which company's model wrote the plan, the judge is from a different company. When it cannot, the verdict says so. Claude Desktop and Claude Code enforce that in code, and tell you if a run lands on your own company anyway. The copy-and-paste routes check it and warn you. A stronger model from the same company, such as Claude Code's advisor, is a useful second look, but it is still that company checking its own work.

That is a rule about who checks. It is not a claim about accuracy.

- **Measured:** a weekly regression check on 29 made-up cases. It counts how often the judge catches a planted flaw and how often it raises a false alarm on a sound plan. It also checks that the judge came from a different company than the declared author. That is a routing check. It does not measure whether the judge's errors differ from the writer's. The 29 cases were used to write the judge's instructions, so a full score says nothing about how good the judge is. The detail is in [evals/README.md](../evals/README.md).
- **Not measured yet:** whether an outside judge catches more than your own assistant starting fresh. Until it is, Grill does not claim it.

Grill is the outside judge step Felix Rieseberg recommends in [How to be more ambitious](https://felixrieseberg.com/how-to-be-more-ambitious-a-tutorial-for-humans-with-models/): do not ask the model to judge itself.

The judge must argue your side before it attacks, quote the words it targets, and give every challenge a test that would settle it. A verdict of "solid" with no challenges is a real answer when it's earned. It's told that a made-up objection and an unearned "solid" both cost you.

A different company isn't enough on its own. The write-up still comes from your side of the decision, and a judge that grades the framing hands your own conclusion back to you. So:
- **Claude writes the write-up as a clerk, not an advocate.** Every option gets the same depth. The case against goes in at full strength, and nobody answers it. The question names every option and doesn't lean toward one.
- **The judge is told who wrote it.** It judges the facts, not the framing. It argues the other side with the same effort, then checks whether its verdict would change if the other side had written up the same facts.

The checks on a single grill, and how Grill gets better without reading a real decision, are in [LEARNING.md](../LEARNING.md).
