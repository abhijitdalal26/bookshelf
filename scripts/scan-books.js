// Scans a books directory and emits app/books.js with metadata for the 3D shelf.
// Usage: node scripts/scan-books.js [booksDir] [outFile]   (booksDir defaults to shelf.config.json)
// Improvements: better title guessing, hierarchical series, smarter Open Library matching,
// fallback metadata for known books, skip non-book files.

const fs = require("fs");
const path = require("path");

const BOOKS_DIR = path.resolve(process.argv[2] || require("./config").booksDir);
const OUT_FILE = process.argv[3] || path.join(__dirname, "..", "app", "books.js");

const EXTS = new Set([".pdf", ".epub", ".mobi", ".azw3", ".djvu"]);

// Open Library cover by numeric cover id (each id below was checked to return an image)
const ol = (id) => `https://covers.openlibrary.org/b/id/${id}-M.jpg`;

// Known metadata overrides for files the Open Library search gets wrong (matched by file name;
// they were written for the original owner's library and do nothing for files you don't have)
const OVERRIDES = {
  "France.pdf": { title: "Constitution of France", author: "", year: 1958, pages: null, cover: null },
  "Germany.pdf": { title: "Basic Law for the Federal Republic of Germany", author: "", year: 1949, pages: null, cover: null },
  "Japan.pdf": { title: "Constitution of Japan", author: "", year: 1947, pages: null, cover: null },
  "Russia.pdf": { title: "Constitution of Russia", author: "", year: 1993, pages: null, cover: null },
  "US.pdf": { title: "Constitution of the United States", author: "", year: 1787, pages: null, cover: null },
  "China Constitution.pdf": { title: "Constitution of China", author: "", year: 1982, pages: null, cover: null },
  "Indian constitution.pdf": { title: "Constitution of India", author: "", year: 1950, pages: null, cover: null },
  "william.pdf": { title: "Complete Works of Shakespeare", author: "William Shakespeare", year: 1623, pages: null, cover: null },
  "The Great Leveler.pdf": { title: "The Great Leveler", author: "Walter Scheidel", year: 2017, pages: 504, cover: null },
  "Alexander the Great _ a new history.pdf": { title: "Alexander the Great: A New History", author: "Waldemar Heckel", year: 2009, pages: 358, cover: null },
  "paul-kennedy-the-rise-and-fall-of-the-great-powers-19891.pdf": { title: "The Rise and Fall of the Great Powers", author: "Paul Kennedy", year: 1989, pages: 677, cover: null },
  "TheHobbit-J.R.R.Tolkien.pdf": { title: "The Hobbit", author: "J.R.R. Tolkien", year: 1937, pages: 310, cover: null },
  "Tolkien-J.-The-lord-of-the-rings-HarperCollins-ebooks-2010.pdf": { title: "The Lord of the Rings", author: "J.R.R. Tolkien", year: 1954, pages: 1178, cover: null },
  "BhagavadGitaInHindiPDF-1.pdf": { title: "Bhagavad Gita", author: "", year: null, pages: null, cover: null },
  "English-Grammar-in-Use.-Murphy-R.-2019-5th-394p-.pdf": { title: "English Grammar in Use", author: "Raymond Murphy", year: 2019, pages: 394, cover: null },
  "confessions-of-an-advertising-man-ogilvy-pdf-free (1).pdf": { title: "Confessions of an Advertising Man", author: "David Ogilvy", year: 1963, pages: 224, cover: null },
  "Cant hurt me master the mind and deffy the odd.pdf": { title: "Can't Hurt Me", author: "David Goggins", year: 2018, pages: 364, cover: null },
  "10 Days to Faster Reading.pdf _ TOAZ.INFO.pdf": { title: "10 Days to Faster Reading", author: "Abby Marks Beale", year: 2001, pages: 224, cover: null },
  "Becoming-Michelle-Obama.pdf": { title: "Becoming", author: "Michelle Obama", year: 2018, pages: 448, cover: null },
  "crime-and-punishment00dostiala.pdf": { title: "Crime and Punishment", author: "Fyodor Dostoevsky", year: 1866, pages: 520, cover: null },
  "born-a-crime-trevor-noah.pdf": { title: "Born a Crime", author: "Trevor Noah", year: 2016, pages: 304, cover: null },
  "Wealth-Nations.pdf": { title: "The Wealth of Nations", author: "Adam Smith", year: 1776, pages: 590, cover: null },
  "1 Our Oriental Heritage.pdf": { title: "Our Oriental Heritage", author: "Will Durant", year: 1935, pages: 1049, cover: null },
  "2 The Life of Greece.pdf": { title: "The Life of Greece", author: "Will Durant", year: 1939, pages: 755, cover: null },
  "3 Caesar and Christ.pdf": { title: "Caesar and Christ", author: "Will Durant", year: 1944, pages: 751, cover: null },
  "4 The Age of Faith.pdf": { title: "The Age of Faith", author: "Will Durant", year: 1950, pages: 1196, cover: null },
  "5 The Renaissance.pdf": { title: "The Renaissance", author: "Will Durant", year: 1953, pages: 776, cover: null },
  "6 The Reformation.pdf": { title: "The Reformation", author: "Will Durant", year: 1957, pages: 1025, cover: null },
  "7 The Age of Reason Begins.pdf": { title: "The Age of Reason Begins", author: "Will Durant", year: 1961, pages: 729, cover: null },
  "8 The Age of Louis XIV.pdf": { title: "The Age of Louis XIV", author: "Will Durant", year: 1963, pages: 802, cover: null },
  "9 The Age of Voltaire.pdf": { title: "The Age of Voltaire", author: "Will Durant", year: 1965, pages: 945, cover: null },
  "10 Rousseau and Revolution.pdf": { title: "Rousseau and Revolution", author: "Will Durant", year: 1967, pages: 1141, cover: null },
  "11 The Age of Napoleon.pdf": { title: "The Age of Napoleon", author: "Will Durant", year: 1975, pages: 876, cover: null },
  "Frank_Herberts_Dune_Saga_Collection_Books_1_-_6_-_Frank_Herbert.pdf": { title: "Dune Saga Collection (Books 1–6)", author: "Frank Herbert", year: 1965, pages: null, cover: null },
  "Elon Musk Tesla, SpaceX, and the Quest for a Fantastic Future by Vance, Ashlee (z-lib.org).epub.pdf": { title: "Elon Musk", author: "Ashlee Vance", year: 2015, pages: 396, cover: null },
  // --- Verified against Open Library / arXiv / PDF front matter. Unknown fields stay null. ---
  // AI Architecture
  "Design Patterns - Elements of Reusable Object Oriented Software.pdf": { title: "Design Patterns", author: "Erich Gamma, Richard Helm, Ralph Johnson, John Vlissides", year: 1994, pages: 395, cover: null, search: false },
  "[O'Reilly] Architecting Data and Machine Learning Platforms.pdf": { title: "Architecting Data and Machine Learning Platforms", author: "Marco Tranquillin, Valliappa Lakshmanan", year: 2023, pages: null, cover: null, search: false },
  "[O'Reilly] Building Applications with AI Agents Designing and Implementing Multiagent Systems.pdf": { title: "Building Applications with AI Agents", author: "Michael Albada", year: 2025, pages: 352, cover: null, search: false },
  "[O'Reilly] Designing Machine Learning Systems.pdf": { title: "Designing Machine Learning Systems", author: "Chip Huyen", year: 2022, pages: 386, cover: ol(13314480), search: false },
  "designing-machine-learning-systems-an-iterative-process-for-production-ready-applications-1nbsped-1098107969-9781098107963.pdf": { title: "Designing Machine Learning Systems", author: "Chip Huyen", year: 2022, pages: 386, cover: ol(13314480), search: false },
  "[O'Reilly] Generative AI Design Patterns.pdf": { title: "Generative AI Design Patterns", author: "Valliappa Lakshmanan, Hannes Hapke", year: 2025, pages: 506, cover: null, search: false },
  "[O'Reilly] Generative AI on Kubernetes Operationalizing Large Language Models.pdf": { title: "Generative AI on Kubernetes", author: "Roland Huß, Daniele Zonca", year: 2026, pages: 405, cover: ol(15273482), search: false },
  "[O'Reilly] Machine Learning Design Patterns_Solutions to Common Challenges in Data Preparation Model Building and MLOps.pdf": { title: "Machine Learning Design Patterns", author: "Valliappa Lakshmanan, Sara Robinson, Michael Munn", year: 2020, pages: 400, cover: null, search: false },
  // AI books
  "[O'Reilly] AI Engineering_Building Applications with Foundation Models_Chip Huyen.pdf": { title: "AI Engineering", author: "Chip Huyen", year: 2024, pages: 442, cover: ol(15091156), search: false },
  "[O'Reilly] AI-Powered Business Intelligence_Improve Forecasts and Decision Making with Machine Learning_Tobias Zwingmann.pdf": { title: "AI-Powered Business Intelligence", author: "Tobias Zwingmann", year: 2022, pages: null, cover: ol(14620146), search: false },
  "[O'Reilly] Al and Machine Learning for Coders.pdf": { title: "AI and Machine Learning for Coders", author: "Laurence Moroney", year: 2020, pages: 300, cover: ol(14832334), search: false },
  "[O'Reilly] Beyond Vibe Coding From Coder to AI-Era Developer.pdf": { title: "Beyond Vibe Coding", author: "Addy Osmani", year: 2025, pages: null, cover: null, search: false },
  "eBook-How-to-Build-a-Career-in-AI.pdf": { title: "How to Build Your Career in AI", author: "Andrew Ng", year: null, pages: null, cover: null, search: false },
  // Data science
  "Data Mining Concepts and Techniques 3rd Edition.pdf": { title: "Data Mining: Concepts and Techniques", author: "Jiawei Han, Micheline Kamber, Jian Pei", year: 2011, pages: 703, cover: ol(8635653), search: false },
  "The Probability and Statistics Cookbook.pdf": { title: "The Probability and Statistics Cookbook", author: "Matthias Vallentin", year: null, pages: null, cover: null, search: false },
  "[O'Reilly] Database Internals.pdf": { title: "Database Internals", author: "Alex Petrov", year: 2019, pages: 280, cover: ol(14572292), search: false },
  "[O'Reilly] Practical Statistics for Data Scientists.pdf": { title: "Practical Statistics for Data Scientists", author: "Peter Bruce, Andrew Bruce", year: 2017, pages: null, cover: ol(8512070), search: false },
  "[O'Reilly] Python Data Science Handbook - Jake VanderPlas.pdf": { title: "Python Data Science Handbook", author: "Jake VanderPlas", year: 2016, pages: 548, cover: ol(8512092), search: false },
  "[O'Reilly] Python for Data Analysis - data wrangling with Pandas NumPy and IPython.pdf": { title: "Python for Data Analysis (2nd ed.)", author: "Wes McKinney", year: 2017, pages: null, cover: null, search: false },
  // LLM and NLP
  "Prompt Engineering Guide VN.pdf": { title: "Foundation of Prompt Engineering", author: "Hoang-Bach Ngo, Minh-Hung An", year: 2024, pages: null, cover: null, search: false },
  "[Manning] Domain-Specific Small Language Models Efficient AI for local deployment.pdf": { title: "Domain-Specific Small Language Models", author: "Guglielmo Iozzia", year: 2025, pages: null, cover: null, search: false },
  "[O'Reilly] Applied Natural Language Processing in the Enterprise.pdf": { title: "Applied Natural Language Processing in the Enterprise", author: "Ankur A. Patel, Ajay Uppili Arasanipalai", year: 2021, pages: null, cover: ol(14559599), search: false },
  "[O'Reilly] Designing Large Language Model Applications (2023).pdf": { title: "Designing Large Language Model Applications", author: "Suhas Pai", year: 2025, pages: 354, cover: null, search: false },
  "[O'Reilly] Natural Language Processing With Python.pdf": { title: "Natural Language Processing with Python", author: "Steven Bird, Ewan Klein, Edward Loper", year: 2009, pages: 508, cover: ol(6296394), search: false },
  "[O'Reilly] Natural Language Processing with Transformers.pdf": { title: "Natural Language Processing with Transformers", author: "Lewis Tunstall, Leandro von Werra, Thomas Wolf", year: 2022, pages: null, cover: ol(14559602), search: false },
  "[O'Reilly] Natural-Language-Annotation-for-Machine-Learning.pdf": { title: "Natural Language Annotation for Machine Learning", author: "James Pustejovsky, Amber Stubbs", year: 2012, pages: 342, cover: ol(7821181), search: false },
  "[O'Reilly] Practical Natural Language Processing.pdf": { title: "Practical Natural Language Processing", author: "Sowmya Vajjala, Bodhisattwa Majumder, Anuj Gupta, Harshit Surana", year: 2020, pages: 325, cover: ol(9424364), search: false },
  "[O'Reilly] Prompt Engineering for LLMs.pdf": { title: "Prompt Engineering for LLMs", author: "John Berryman, Albert Ziegler", year: 2024, pages: 250, cover: ol(14752398), search: false },
  "[Stanford] Speech and Language Processing.pdf": { title: "Speech and Language Processing", author: "Dan Jurafsky, James H. Martin", year: 2000, pages: null, cover: ol(85431), search: false },
  // LLMOps / MLOps
  "Generative AI with LangChain (2024).pdf": { title: "Generative AI with LangChain", author: "Ben Auffarth", year: 2023, pages: null, cover: null, search: false },
  "[O'Reilly] Building Generative AI Services with FastAPI.pdf": { title: "Building Generative AI Services with FastAPI", author: "Ali Parandeh", year: 2025, pages: 400, cover: null, search: false },
  "[O'Reilly] FastAPI.pdf": { title: "FastAPI", author: "Bill Lubanovic", year: 2023, pages: null, cover: null, search: false },
  "[O'Reilly] Practical MLOps_Operationalizing Machine Learning Models.pdf": { title: "Practical MLOps", author: "Noah Gift, Alfredo Deza", year: 2021, pages: 492, cover: null, search: false },
  "[O'Reilly] Python for DevOps_Learn Ruthlessly Effective Automation.pdf": { title: "Python for DevOps", author: "Noah Gift, Kennedy Behrman, Alfredo Deza, Grig Gheorghiu", year: 2019, pages: 506, cover: ol(10236917), search: false },
  "[O'Reilly] What is LLMOps_Large Language Models in Production.pdf": { title: "What Is LLMOps?", author: "Abi Aryan", year: 2024, pages: null, cover: null, search: false },
  // Machine learning
  "ML_basic_VN.pdf": { title: "Machine Learning cơ bản", author: "Vũ Hữu Tiệp", year: 2016, pages: null, cover: null, search: false },
  "Machine_learning_VN.pdf": { title: "Machine Learning Yearning (Vietnamese)", author: "Andrew Ng", year: 2018, pages: null, cover: null, search: false },
  "andrew-ng-machine-learning-yearning.pdf": { title: "Machine Learning Yearning", author: "Andrew Ng", year: 2018, pages: null, cover: null, search: false },
  "[O'Reilly] Fundamentals of Deep Learning.pdf": { title: "Fundamentals of Deep Learning", author: "Nikhil Buduma, Nicholas Locascio", year: 2017, pages: 298, cover: ol(8511889), search: false },
  "[O'Reilly] Hands On Machine Learning with Scikit Learn and TensorFlow.pdf": { title: "Hands-On Machine Learning with Scikit-Learn and TensorFlow", author: "Aurélien Géron", year: 2017, pages: 574, cover: ol(8509535), search: false },
  "[O'Reilly] Introduction to Machine Learning with Python.pdf": { title: "Introduction to Machine Learning with Python", author: "Andreas C. Müller, Sarah Guido", year: 2016, pages: 376, cover: ol(7435335), search: false },
  // Papers and lectures (arXiv metadata / PDF front matter)
  "1910.13461v1.pdf": { title: "BART: Denoising Sequence-to-Sequence Pre-training", author: "Mike Lewis et al.", year: 2019, pages: null, cover: null, search: false },
  "2001.08210v2.pdf": { title: "mBART: Multilingual Denoising Pre-training", author: "Yinhan Liu et al.", year: 2020, pages: null, cover: null, search: false },
  "2107.03374v2.pdf": { title: "Evaluating Large Language Models Trained on Code", author: "Mark Chen et al.", year: 2021, pages: null, cover: null, search: false },
  "2111.09543v4.pdf": { title: "DeBERTaV3", author: "Pengcheng He et al.", year: 2021, pages: null, cover: null, search: false },
  "2305.20050v1.pdf": { title: "Let's Verify Step by Step", author: "Hunter Lightman et al.", year: 2023, pages: null, cover: null, search: false },
  "2306.05685.pdf": { title: "Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena", author: "Lianmin Zheng et al.", year: 2023, pages: null, cover: null, search: false },
  "2311.12022v1.pdf": { title: "GPQA: A Graduate-Level Google-Proof Q&A Benchmark", author: "David Rein et al.", year: 2023, pages: null, cover: null, search: false },
  "2401.05566.pdf": { title: "Sleeper Agents", author: "Evan Hubinger et al.", year: 2024, pages: null, cover: null, search: false },
  "2406.01574v6.pdf": { title: "MMLU-Pro", author: "Yubo Wang et al.", year: 2024, pages: null, cover: null, search: false },
  "2408.08435v1.pdf": { title: "Automated Design of Agentic Systems", author: "Shengran Hu, Cong Lu, Jeff Clune", year: 2024, pages: null, cover: null, search: false },
  "2408.08921v1.pdf": { title: "Graph Retrieval-Augmented Generation: A Survey", author: "Boci Peng et al.", year: 2024, pages: null, cover: null, search: false },
  "2408.12599v1.pdf": { title: "Controllable Text Generation for LLMs: A Survey", author: "Xun Liang et al.", year: 2024, pages: null, cover: null, search: false },
  "2410.03131v3.pdf": { title: "AIME: AI System Optimization via Multiple LLM Evaluators", author: "Bhrij Patel et al.", year: 2024, pages: null, cover: null, search: false },
  "2501.14249v5.pdf": { title: "Humanity's Last Exam", author: "Long Phan et al.", year: 2025, pages: null, cover: null, search: false },
  "GAN Ian Goodfellow.pdf": { title: "Generative Adversarial Networks (NIPS 2016 Tutorial)", author: "Ian Goodfellow", year: 2016, pages: null, cover: null, search: false },
  "HowtoReadPaper.pdf": { title: "How to Read a Paper", author: "S. Keshav", year: 2007, pages: null, cover: null, search: false },
  "LLM_codegen_lecture.pdf": { title: "Large Language Models for Code Generation", author: "Xinyun Chen", year: null, pages: null, cover: null, search: false },
  "aws-serverless.pdf": { title: "Serverless on AWS", author: "Thanh Dang", year: 2024, pages: null, cover: null, search: false },
  "contrastive-learning-ECCV-tutorial_ting_Chen.pdf": { title: "Contrastive Learning of Visual Representations", author: "Ting Chen", year: 2020, pages: null, cover: null, search: false },
  "glaze-usenix23.pdf": { title: "Glaze: Protecting Artists from Style Mimicry", author: "Shawn Shan et al.", year: 2023, pages: null, cover: null, search: false },
  "stanford-cheatsheet-transformers-large-language-models.pdf": { title: "Transformers & Large Language Models Cheatsheet", author: "Afshine Amidi, Shervine Amidi", year: 2025, pages: null, cover: null, search: false },
  "the_craft_of_reseach.pdf": { title: "The Craft of Research", author: "Wayne C. Booth, Gregory G. Colomb, Joseph M. Williams", year: 2008, pages: null, cover: ol(6716065), search: false },
  // Misc
  "_OceanofPDF.com_Million_Dollar_Weekend_-_Noah_Kagan.pdf": { title: "Million Dollar Weekend", author: "Noah Kagan, Tahl Raz", year: 2024, pages: null, cover: ol(14625512), search: false },
  "The Autobiography of Malcolm X.pdf": { title: "The Autobiography of Malcolm X", author: "Malcolm X, Alex Haley", year: 1965, pages: 484, cover: ol(14875135), search: false },
  "The Silk Road_ A New History of the World.pdf": { title: "The Silk Roads", author: "Peter Frankopan", year: 2015, pages: null, cover: ol(8963642), search: false },
  "The new silk roads.pdf": { title: "The New Silk Roads", author: "Peter Frankopan", year: 2018, pages: 328, cover: ol(8807384), search: false },
};

// Cover ids for existing overrides that had none (matched by file name; checked to return an image)
const COVER_IDS = {
  "Becoming-Michelle-Obama.pdf": 8824664,
  "Tolkien-J.-The-lord-of-the-rings-HarperCollins-ebooks-2010.pdf": 14625765,
  "crime-and-punishment00dostiala.pdf": 15183762,
  "william.pdf": 2383682,
  "Frank_Herberts_Dune_Saga_Collection_Books_1_-_6_-_Frank_Herbert.pdf": 13790987,
  "1 Our Oriental Heritage.pdf": 809472,
  "2 The Life of Greece.pdf": 463315,
  "3 Caesar and Christ.pdf": 1365503,
  "4 The Age of Faith.pdf": 7434865,
  "6 The Reformation.pdf": 6556754,
  "7 The Age of Reason Begins.pdf": 6751575,
  "8 The Age of Louis XIV.pdf": 403602,
  "9 The Age of Voltaire.pdf": 809479,
  "10 Rousseau and Revolution.pdf": 406976,
  "11 The Age of Napoleon.pdf": 405392,
};

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      // skip non-book directories
      if (e.name === "xsim" || e.name === "World History by Khan Academy") continue;
      walk(p, out);
    } else if (EXTS.has(path.extname(e.name).toLowerCase())) {
      out.push(p);
    }
  }
  return out;
}

function cleanName(file) {
  let s = path.basename(file, path.extname(file));
  s = s
    .replace(/_OceanofPDF\.com_/gi, " ")
    .replace(/TOAZ\.INFO/gi, "")
    .replace(/\(z-lib\.org\)/gi, "")
    .replace(/00dostiala/gi, "")
    .replace(/^\s*\[(?:O'Reilly|Manning|MIT|Springer|Stanford|Packt|Apress)\]\s*/i, "") // publisher tag prefix
    .replace(/\.epub$/gi, "")       // for files like "book.epub.pdf"
    .replace(/\(\d+\)/g, " ")
    .replace(/[_+]+/g, " ")
    .replace(/\.pdf\s*/gi, "")      // embedded .pdf in name
    .replace(/\s{2,}/g, " ")
    .trim();
  // strip leading volume/part numbers like "1 Our Oriental Heritage"
  s = s.replace(/^\d+\s+(?=[A-Z])/, "").trim();
  return s;
}

function guessAuthor(cleaned, dir) {
  // "Title by Author" or "Title — Author" or "Title - Author"
  const m = cleaned.match(/\s+(?:by|—|–|-)\s+([^-–—]{2,60})$/i);
  if (m) return m[1].trim();
  // folder hints like "Book by Douglas Adams"
  const parent = path.basename(dir);
  const parentMatch = parent.match(/(?:by|of)\s+([A-Z][a-z]+ [A-Z][a-z]+.*)/i);
  if (parentMatch) return parentMatch[1].trim();
  return "";
}

function guessTitle(cleaned) {
  const m = cleaned.match(/^(.*?)\s+(?:by|—|–)\s+[^-–—]{2,60}$/i);
  return (m ? m[1] : cleaned).trim();
}

// Build hierarchical series from the full path relative to BOOKS_DIR
function buildSeries(filePath) {
  const rel = path.relative(BOOKS_DIR, path.dirname(filePath));
  if (!rel || rel === ".") return "";

  // For deeply nested: History/Books -> "History"
  // For History/Books/Story of Civilization... -> "History / Story of Civilization..."
  const parts = rel.split(path.sep).filter(Boolean);

  // Remove generic folder names
  const GENERIC = new Set(["Books", "books"]);
  const meaningful = parts.filter(p => !GENERIC.has(p));

  if (meaningful.length === 0) return "";
  if (meaningful.length === 1) return meaningful[0];
  // Join with " / " for multi-level hierarchy
  return meaningful.join(" / ");
}

async function searchOpenLibrary(query) {
  try {
    const url = "https://openlibrary.org/search.json?limit=1&fields=title,author_name,first_publish_year,cover_i,number_of_pages_median&q=" +
      encodeURIComponent(query.slice(0, 80));
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const j = await res.json();
    const d = j.docs && j.docs[0];
    if (!d) return null;

    // Sanity check: if the returned title is wildly different from our query, skip it
    const qt = query.toLowerCase().replace(/[^a-z0-9]/g, "");
    const rt = (d.title || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    // Check if there's reasonable overlap (at least some word in common)
    const qWords = new Set(query.toLowerCase().split(/\s+/).filter(w => w.length > 3));
    const rWords = new Set((d.title || "").toLowerCase().split(/\s+/).filter(w => w.length > 3));
    let overlap = 0;
    for (const w of qWords) if (rWords.has(w)) overlap++;
    if (qWords.size > 0 && overlap === 0 && qt.length > 5 && !rt.includes(qt.slice(0, 8))) {
      // No word overlap and no substring match = probably wrong result
      return null;
    }

    return {
      title: d.title || null,
      author: (d.author_name && d.author_name[0]) || null,
      year: d.first_publish_year || null,
      cover: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg` : null,
      pages: d.number_of_pages_median || null,
    };
  } catch {
    return null;
  }
}

// Fallback when Open Library has no confident match. Google Books anonymous quota is small,
// so any failure (429, timeout, no match) just returns null. Requires a clear title match.
async function searchGoogleBooks(title, author) {
  try {
    const norm = (x) => (x || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const q = "intitle:" + title.slice(0, 70) + (author ? "+inauthor:" + author : "");
    const res = await fetch("https://www.googleapis.com/books/v1/volumes?maxResults=3&q=" + encodeURIComponent(q), { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const j = await res.json();
    const nt = norm(title);
    const it = (j.items || []).find((x) => nt.length > 5 && norm(x.volumeInfo && x.volumeInfo.title) === nt);
    if (!it) return null;
    const v = it.volumeInfo;
    const year = parseInt((v.publishedDate || "").slice(0, 4), 10);
    const img = v.imageLinks && (v.imageLinks.thumbnail || v.imageLinks.smallThumbnail);
    return {
      title: v.title || null,
      author: (v.authors && v.authors.join(", ")) || null,
      year: year || null,
      pages: v.pageCount || null,
      cover: img ? img.replace(/^http:/, "https:") : null,
    };
  } catch {
    return null;
  }
}

async function main() {
  const files = walk(BOOKS_DIR).sort();
  const books = [];
  const CONCURRENCY = 6;

  console.log(`Found ${files.length} book files in ${BOOKS_DIR}`);

  for (let i = 0; i < files.length; i += CONCURRENCY) {
    const batch = files.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (file) => {
        const dir = path.dirname(file);
        const basename = path.basename(file);
        const cleaned = cleanName(file);
        const fallbackTitle = guessTitle(cleaned);
        const fallbackAuthor = guessAuthor(cleaned, dir);
        const series = buildSeries(file);

        // Check overrides first
        const override = OVERRIDES[basename];
        if (override) {
          // Even with override, try to get cover from Open Library if we don't have one
          let cover = override.cover || (COVER_IDS[basename] ? ol(COVER_IDS[basename]) : null);
          if (!cover && override.title && override.search !== false) {
            const meta = await searchOpenLibrary(override.title + (override.author ? " " + override.author : ""));
            if (meta && meta.cover) cover = meta.cover;
          }
          return {
            title: override.title,
            author: override.author,
            series,
            path: file.replace(/\\/g, "/"),
            year: override.year,
            pages: override.pages,
            cover,
          };
        }

        const searchQuery = fallbackTitle || cleaned;
        let meta = await searchOpenLibrary(
          searchQuery + (fallbackAuthor ? " " + fallbackAuthor : "")
        );
        if (!meta) meta = await searchGoogleBooks(searchQuery, fallbackAuthor);

        return {
          title: (meta && meta.title) || fallbackTitle || cleaned,
          author: (meta && meta.author) || fallbackAuthor,
          series,
          path: file.replace(/\\/g, "/"),
          year: meta && meta.year,
          pages: meta && meta.pages,
          cover: meta && meta.cover,
        };
      })
    );
    books.push(...results);
    process.stderr.write(`\r${Math.min(i + CONCURRENCY, files.length)}/${files.length}`);
  }
  process.stderr.write("\n");

  const root = BOOKS_DIR.replace(/\\/g, "/").replace(/\/$/, "");
  fs.writeFileSync(
    OUT_FILE,
    `window.BOOKS_ROOT = ${JSON.stringify(root)};\n` + "window.BOOKS = " + JSON.stringify(books, null, 1) + ";\n"
  );
  console.log(`Wrote ${books.length} books to ${OUT_FILE}`);
}

main();
