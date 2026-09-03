const { EngineClient, OpenAIClient } = require("E:/progs/Translator++/www/addons/openai/Engine/openai.js");

async function testFull() {
  console.log("Creating OpenAI client matching Translator++ addon configuration...");
  const client = new OpenAIClient({
    baseURL: "http://127.0.0.1:8081/v1",
    apiKey: "sk-personal-gw"
  });

  const textsToTranslate = [
    "Hey! What are you doing here alone?",
    "I was waiting for you, [Player.Name]! (locked)",
    "Don't worry, everything is going to be just fine.",
    "[[Let's go back to the club]"
  ];

  console.log("\nSource texts:");
  textsToTranslate.forEach((t, i) => console.log(`  [${i}]: ${t}`));

  console.log("\nCalling client.generate with model 'gemini-3.1-pro'...");
  const startTime = Date.now();
  const translations = await client.generate(textsToTranslate, "gemini-3.1-pro", "Russian");
  const elapsed = Date.now() - startTime;

  console.log(`\nTranslation finished in ${elapsed}ms:`);
  translations.forEach((t, i) => console.log(`  [${i}]: ${t}`));
}

testFull().catch(err => {
  console.error("Test failed:", err);
});
