import { LearningSettings } from "../../../src/learning-loop";

export default function LearningSettingsPanel({ onDoctor }) {
  return <section>
    <h2>学习与记忆</h2>
    <p>管理医生档案、使用习惯和资料使用授权。</p>
    <button onClick={onDoctor}>医生档案与记忆</button>
    <LearningSettings />
  </section>;
}
