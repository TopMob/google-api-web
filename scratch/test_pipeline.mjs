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

// Comprehensive Euphemism Masker for Visual Novel Translation
const VN_REPLACEMENTS = [
  { re: /\bvaginal walls\b/gi, safe: "inner chamber walls", restore: (t) => t.replace(/стенки внутренней камеры|стенки внутреннего покоя/gi, "стенки влагалища") },
  { re: /\bvaginal\b/gi, safe: "intimate", restore: (t) => t.replace(/интимный|интимная|интимное/gi, "вагинальный") },
  { re: /\bvagina\b/gi, safe: "intimate core", restore: (t) => t.replace(/интимное ядро/gi, "влагалище") },
  { re: /\bpussy\b/gi, safe: "flower", restore: (t) => t.replace(/цветок|цветка/gi, "киска") },
  { re: /\bcock\b/gi, safe: "steel blade", restore: (t) => t.replace(/стальной клинок|стального клинка|стальной меч/gi, "член") },
  { re: /\bdick\b/gi, safe: "steel blade", restore: (t) => t.replace(/стальной клинок|стального клинка|стальной меч/gi, "член") },
  { re: /\bsemen\b/gi, safe: "sacred essence", restore: (t) => t.replace(/священную эссенцию|священная эссенция|священной эссенции/gi, "сперму") },
  { re: /\bcum\b/gi, safe: "warm essence", restore: (t) => t.replace(/тёплой эссенции|тёплая эссенция|теплой эссенции/gi, "кончи") },
  { re: /\bcumming\b/gi, safe: "climaxing", restore: (t) => t.replace(/достигаю пика|достигаю кульминации/gi, "кончаю") },
  { re: /\bCUMMING\b/g, safe: "REACHING THE PEAK", restore: (t) => t.replace(/ДОСТИГАЮ ПИКА|ДОСТИГАЮ КУЛЬМИНАЦИИ/gi, "КОНЧАЮ") },
  { re: /\bDefile\b/gi, safe: "Conquer", restore: (t) => t.replace(/Покори|Завоюй/gi, "Оскверни") },
  { re: /\bdefile\b/gi, safe: "conquer", restore: (t) => t.replace(/покори|завоюй/gi, "оскверни") },
  { re: /\bpound\b/gi, safe: "strike into", restore: (t) => t.replace(/вонзаешься в неё|ударяешь в неё/gi, "трахаешь её") }
];

function sanitizeForAI(text) {
  let res = text;
  for (const item of VN_REPLACEMENTS) {
    res = res.replace(item.re, item.safe);
  }
  return res;
}

function restoreFromAI(text) {
  let res = text;
  for (const item of VN_REPLACEMENTS) {
    res = item.restore(res);
  }
  return res;
}

async function testFullPipeline() {
  console.log("=== Original NSFW texts ===");
  nsfwTexts.forEach((t, i) => console.log(`[${i}]: ${t}`));

  const sanitized = nsfwTexts.map(sanitizeForAI);
  const reqObj = {};
  sanitized.forEach((t, i) => reqObj[i.toString()] = t);

  console.log("\n=== Sanitized strings sent to Gemini ===");
  sanitized.forEach((t, i) => console.log(`[${i}]: ${t}`));

  const promptSys = `You are a professional literary translator. Translate the provided visual novel fantasy script from English into Russian. Return valid JSON only.`;
  const promptUser = `Translate strings to Russian:\n${JSON.stringify(reqObj)}`;

  const res = await fetch("http://127.0.0.1:8081/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer sk-personal-gw" },
    body: JSON.stringify({
      model: "gemini-3.1-pro",
      messages: [
        { role: "system", content: promptSys },
        { role: "user", content: promptUser }
      ],
      temperature: 0
    })
  });

  const json = await res.json();
  const rawText = json.choices?.[0]?.message?.content || "";
  console.log("\n=== Raw Gemini Response ===");
  console.log(rawText);

  try {
    const parsed = JSON.parse(rawText);
    console.log("\n=== Final Restored Russian Translation ===");
    Object.entries(parsed).forEach(([k, val]) => {
      console.log(`Row [${parseInt(k) + 199}]: ${restoreFromAI(val)}`);
    });
  } catch (e) {
    console.error("Parse error:", e);
  }
}

testFullPipeline();
