const url = "https://wkrjfvivkiwnrmqbptrq.supabase.co/rest/v1/projects?select=*";
const apiKey =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indrcmpmdml2a2l3bnJtcWJwdHJxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAzMzE4MDQsImV4cCI6MjA5NTkwNzgwNH0.dGW2lMUjl20aw1Z659eYsSkItijxnv5w17GrIidBBfY";

fetch(url, {
  headers: {
    apikey: apiKey,
    Authorization: `Bearer ${apiKey}`
  }
})
  .then((res) => res.json())
  .then((data) => {
    console.log("Projects in DB:");
    console.log(JSON.stringify(data, null, 2));
  })
  .catch((err) => console.error(err));
