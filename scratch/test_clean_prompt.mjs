const systemPromptClean = (targetLanguage) => `You are a professional literary translator and game localizer.
Translate the provided in-game dialogue and UI text from English to ${targetLanguage}.

You will receive a JSON object where each value is a text string.
Return ONLY a valid JSON object with the exact same numeric keys.

TRANSLATION GUIDELINES:
1. NATURAL & ACCURATE LOCALIZATION:
   - Translate meaning naturally and colloquially, avoiding literal word-for-word translation.
   - Maintain the character's tone, personality, emotion, and register (formal vs informal).
   - Use informal "ты" for friendly/casual dialogues, formal "Вы" only for respectful/official context.
   - Accurately adapt slang, swear words, idioms, emotional outbursts, and colloquial expressions to sound completely natural in Russian.

2. GENDER & PRONOUN VARIABLES:
   - The player character can be male or female. Preserve and use dynamic localization tags where present:
     * [he] -> "он" / "она"
     * [she] -> "она" / "он"
     * [him] -> "его" / "её"
     * [his] -> "его" / "её"
     * [boy] -> "мальчик" / "девочка"
     * [man] -> "мужчина" / "девушка"
     * [guy] -> "парень" / "девушка"
     * [sir] -> "сэр" / "мэм"
     * [master] -> "господин" / "госпожа"
     * [daddy] -> "папочка" / "мамочка"
     * [g_v] -> "" (male) / "а" (female) for past tense verbs (e.g. "понял[g_v]", "сделал[g_v]")
     * [g_ся] -> "ся" (male) / "лась" (female) (e.g. "разобрал[g_ся]")
     * [g_мой] -> "мой" / "моя"
     * [g_милый] -> "милый" / "милая"
     * [g_доволен] -> "доволен" / "довольна"
     * [g_сам] -> "сам" / "сама"
   - Never use "[him]" or "[he]" as a verb suffix. Use "[g_v]" instead.
   - Keep dialogue neutral or properly tagged for variable genders.

3. PRESERVE CODE VARIABLES & FORMATTING:
   - UI choices with double brackets "[[ ... ]" must retain the exact single closing bracket structure (e.g. "[[Choice text]" -> "[[Текст выбора]").
   - Preserve all variables in single brackets like "[Player.Name]", "[CharName.Petname]" intact.
   - Keep all Ren'Py tags ({b}, {i}, {w}, \\n) exactly as they are.
   - Do not translate technical identifiers, asset paths, or system labels.

4. OUTPUT FORMAT:
   - Return ONLY the JSON object. Do not wrap in markdown codeblocks.
   - Escape quotes properly (\\"). Do not use angle quotation marks (« »).
`;

const userPromptClean = (texts, targetLanguage = "Russian") => {
  const requestObj = {};
  texts.forEach((text, i) => (requestObj[i.toString()] = text));
  return `Translate each JSON value into natural ${targetLanguage}. Preserve all [variables] and tags exactly.\n\nInput JSON:\n${JSON.stringify(requestObj)}`;
};

async function test() {
  const texts = [
    "Damn it, what the hell are you doing here?",
    "I told you to stay away from my room!",
    "Look at her, she's so damn hot in that dress.",
    "Shut up and kiss me already!"
  ];

  const payload = {
    model: "gemini-3.7-flash",
    messages: [
      { role: "system", content: systemPromptClean("Russian") },
      { role: "user", content: userPromptClean(texts, "Russian") }
    ],
    temperature: 0
  };

  const res = await fetch("http://127.0.0.1:8081/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer sk-personal-gw"
    },
    body: JSON.stringify(payload)
  });

  const json = await res.json();
  console.log("Status:", res.status);
  console.log("Raw Response:\n", json.choices?.[0]?.message?.content);
}

test().catch(console.error);
