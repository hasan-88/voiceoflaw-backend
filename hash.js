const bcrypt = require("bcrypt");

async function generateHash() {
  const password = "zafar0088"; // yahan apna password likh
  const saltRounds = 10;

  const hash = await bcrypt.hash(password, saltRounds);
  console.log("Password:", password);
  console.log("Hash:", hash);
}

generateHash();
