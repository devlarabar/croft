import { ChatPage } from "../../../../components/chat-page";
import { html } from "../../../../html";
import { route } from "../../../../http";
import { answerQuestion } from "../../../../qa";

export const POST = route(async (request) => {
  const form = await request.formData();
  const repo = String(form.get("repo"));
  const prNumber = String(form.get("prNumber"));
  const question = String(form.get("question"));
  const response = await answerQuestion({ repo, prNumber: Number(prNumber), question });
  const answer = response.startReview
    ? "That reads as a review request — comment `@croft review` on the PR to start one."
    : response.text;
  return html(<ChatPage repo={repo} prNumber={prNumber} question={question} answer={answer} />);
});
