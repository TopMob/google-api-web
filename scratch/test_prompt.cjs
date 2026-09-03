const { systemPrompt, userPrompt, parseResponse } = require("E:/progs/Translator++/www/addons/openai/Engine/Prompt.js");

async function testTranslation() {
  const texts = [
    "Hello, how are you?",
    "I am going to the shop.",
    "Do you want to come with me?",
    "Yes, of course! (locked)"
  ];
  
  const payload = {
    model: "gemini-3.7-flash",
    messages: [
      { role: "system", content: systemPrompt("Russian") },
      { role: "user", content: userPrompt(texts, "Russian") }
    ],
    temperature: 0
  };

  console.log("Sending request to Gateway...");
  const res = await fetch("http://127.0.0.1:8081/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer sk-personal-gw"
    },
    body: JSON.stringify(payload)
  });

  const json = await res.json();
  console.log("Gateway response status:", res.status);
  console.log("Gateway raw message content:\n", json.choices?.[0]?.message?.content);

  const rawText = json.choices?.[0]?.message?.content || "";
  const parsed = await parseResponse(rawText, texts.length);
  console.log("\nParsed result:", parsed);
  console.log("Result length:", parsed.length, "Expected:", texts.length);
}

testTranslation().catch(console.error);
