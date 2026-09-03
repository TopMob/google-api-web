const systemPromptClean = (targetLanguage) => `You are a professional literary translator and game localizer.
Translate the provided in-game dialogue and UI text from English to ${targetLanguage}.

You will receive a JSON object where each value is a text string.
Return ONLY a valid JSON object with the exact same numeric keys.

TRANSLATION GUIDELINES:
1. NATURAL & ACCURATE LOCALIZATION:
   - Translate meaning naturally and colloquially, avoiding literal word-for-word translation.
   - Maintain the character's tone, personality, emotion, and register (formal vs informal).
   - Use informal "ты" for friendly/casual dialogues, formal "Вы" only for respectful/official context.
   - Accurately adapt slang, idioms, emotional outbursts, and colloquial expressions to sound completely natural in Russian.

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

async function testModel(modelName) {
  console.log(`\n========================================`);
  console.log(`Testing Model: ${modelName}`);
  console.log(`========================================`);

  const texts = [
    "Damn it, what the hell are you doing here?",
    "I was waiting for you all day, [Player.Name]! (locked)",
    "Look at her, she's so stunning in that dress.",
    "[[Let's sneak inside together]"
  ];

  const payload = {
    model: modelName,
    messages: [
      { role: "system", content: systemPromptClean("Russian") },
      { role: "user", content: userPromptClean(texts, "Russian") }
    ],
    temperature: 0
  };

  const startTime = Date.now();
  try {
    const res = await fetch("http://127.0.0.1:8081/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer sk-personal-gw"
      },
      body: JSON.stringify(payload)
    });

    const elapsed = Date.now() - startTime;
    const json = await res.json();
    console.log(`Status: ${res.status} (${elapsed}ms)`);
    if (json.choices?.[0]?.message?.content) {
      console.log("Response Content:\n", json.choices[0].message.content);
    } else {
      console.log("Error or empty choices:", JSON.stringify(json, null, 2));
    }
  } catch (e) {
    console.error(`Request failed for ${modelName}:`, e.message);
  }
}

async function runAll() {
  await testModel("gemini-3.1-pro");
  await testModel("gemini-flash-lite");
  await testModel("gemini-3.5-flash");
}

runAll();
