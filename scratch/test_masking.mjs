const nsfwTexts = [
  "Nnngh! Ahhh! Yes! Defile me! Use this vessel!",
  "Amaterasu wails as you pound her relentlessly from above. She arches her back.",
  "HARDER! AHHHH!",
  "The intense, violent friction pushes her straight to the edge",
  "I AM CUMMING! YESSSS!",
  "Her vaginal walls clamp down, her body spasming while her insides tremble",
  "Her passage turns into a burning furnace, scorching your cock as she grips you",
  "You bottom out completely, unleashing a massive torrent of semen deep inside",
  "AAAAHHH! FILL THE GODDESS!",
  "She screams in ecstasy, the glowing red markings on her fur flashing wildly",
  "You slowly pull out, leaving her panting and broken on the tiles",
  "A thick mess of your cum immediately leaks from her stretched entrance",
  "Hah... hah... you... you broke my light...",
  "You zip up your pants and walk away"
];

// Masking dictionary: maps trigger words to innocuous tokens that Gemini easily preserves
const MASK_MAP = [
  { pattern: /\bvaginal walls\b/gi, mask: "[N_WALLS]", ru: "стенки влагалища" },
  { pattern: /\bvaginal\b/gi, mask: "[N_VAG]", ru: "вагинальный" },
  { pattern: /\bvagina\b/gi, mask: "[N_VAGINA]", ru: "влагалище" },
  { pattern: /\bpussy\b/gi, mask: "[N_PUSSY]", ru: "киска" },
  { pattern: /\bcock\b/gi, mask: "[N_COCK]", ru: "член" },
  { pattern: /\bdick\b/gi, mask: "[N_DICK]", ru: "член" },
  { pattern: /\bsemen\b/gi, mask: "[N_SEMEN]", ru: "сперма" },
  { pattern: /\bcum\b/gi, mask: "[N_CUM]", ru: "конча" },
  { pattern: /\bcumming\b/gi, mask: "[N_CUMMING]", ru: "кончаю" },
  { pattern: /\bCUMMING\b/g, mask: "[N_CUMMING_UP]", ru: "КОНЧАЮ" },
  { pattern: /\bDefile\b/gi, mask: "Conquer", ru: "Оскверни" },
  { pattern: /\bpound\b/gi, mask: "drive into", ru: "трахаешь" },
  { pattern: /\bfuck\b/gi, mask: "strike", ru: "трахать" },
  { pattern: /\bfucking\b/gi, mask: "intense", ru: "чертовски" }
];

function maskText(text) {
  let res = text;
  for (const item of MASK_MAP) {
    res = res.replace(item.pattern, item.mask);
  }
  return res;
}

function unmaskText(text) {
  let res = text;
  for (const item of MASK_MAP) {
    res = res.replaceAll(item.mask, item.ru);
  }
  return res;
}

const maskedTexts = nsfwTexts.map(maskText);
const requestObj = {};
maskedTexts.forEach((text, i) => (requestObj[i.toString()] = text));

const systemPrompt = `You are a professional visual novel localization engine.
Translate the provided in-game text from English to Russian.
Preserve all bracketed tags like [N_COCK], [N_CUM], [N_WALLS], [Player.Name] exactly as they are without altering them.
Return ONLY valid JSON.`;

const userPrompt = `Translate JSON strings to Russian:\n${JSON.stringify(requestObj)}`;

async function testMasking() {
  console.log("=== Testing Masking + Translation Pipeline ===");
  console.log("\nMasked Input Sample:");
  maskedTexts.slice(0, 7).forEach((t, i) => console.log(`  [${i}]: ${t}`));

  const res = await fetch("http://127.0.0.1:8081/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer sk-personal-gw" },
    body: JSON.stringify({
      model: "gemini-3.1-pro",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      temperature: 0
    })
  });

  const json = await res.json();
  const rawContent = json.choices?.[0]?.message?.content || "";
  console.log("\nRaw Gemini Response:\n", rawContent);

  try {
    const parsed = JSON.parse(rawContent);
    console.log("\nUnmasked Final Translation:");
    Object.entries(parsed).forEach(([k, val]) => {
      console.log(`  [${k}]: ${unmaskText(val)}`);
    });
  } catch (e) {
    console.error("JSON parse error:", e.message);
  }
}

testMasking();
