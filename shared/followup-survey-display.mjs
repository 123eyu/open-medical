export function renderQuestionnaire(questionnaire) {
  const tag = { single: "单选", multi: "多选", number: "数值", text: "简答" };
  const lines = [`【随访问卷】${questionnaire.title}`, "请按题号逐题回复，例如：1. 经常", ""];
  questionnaire.questions.forEach((question, index) => {
    lines.push(
      `${index + 1}. ${question.text}（${tag[question.type]}${question.required ? "" : "，可不答"}）`,
    );
    if (question.options)
      lines.push(
        `   ${question.options.map((option, i) => `${i + 1}) ${option.label}`).join("  ")}`,
      );
    else if (question.type === "number" && question.unit)
      lines[lines.length - 1] += ` 单位：${question.unit}`;
  });
  return lines.join("\n").slice(0, 2000);
}
