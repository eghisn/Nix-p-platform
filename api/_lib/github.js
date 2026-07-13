function githubConfig() {
  return {
    token: process.env.GITHUB_TOKEN,
    repository: process.env.GITHUB_REPOSITORY || "eghisn/Nix-p-platform",
    branch: process.env.GITHUB_BRANCH || "main"
  };
}

export function isGitHubDeployConfigured() {
  return Boolean(githubConfig().token);
}

async function githubFetch(path, options = {}) {
  const { token } = githubConfig();
  if (!token) throw new Error("GitHub deploy token is not configured.");
  const response = await fetch(`https://api.github.com${path}`, {
    method: options.method || "GET",
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "content-type": "application/json",
      "user-agent": "nixp-admin-deploy",
      "x-github-api-version": "2022-11-28"
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.message || `GitHub request failed: ${response.status}`);
  return payload;
}

function toPublicStore(store) {
  return {
    version: store.version || null,
    products: (store.products || []).filter((product) => product.publishStatus === "Published" && product.visibility === "Public"),
    artists: (store.artists || []).filter((artist) => artist.status !== "Draft" && artist.status !== "Archived"),
    collections: (store.collections || []).filter((collection) => collection.status !== "Draft" && collection.status !== "Archived"),
    requests: [],
    orders: [],
    cashflow: [],
    inventory: []
  };
}

export async function commitPublicStore(store, { message } = {}) {
  const { repository, branch } = githubConfig();
  const path = "public/data/public-store.json";
  const current = await githubFetch(`/repos/${repository}/contents/${path}?ref=${encodeURIComponent(branch)}`);
  const content = `${JSON.stringify(toPublicStore(store), null, 2)}\n`;
  const encoded = Buffer.from(content, "utf8").toString("base64");
  const result = await githubFetch(`/repos/${repository}/contents/${path}`, {
    method: "PUT",
    body: {
      message: message || `Deploy NIXP catalog ${new Date().toISOString()}`,
      content: encoded,
      sha: current.sha,
      branch
    }
  });
  return {
    repository,
    branch,
    commitSha: result.commit?.sha || null,
    commitUrl: result.commit?.html_url || null
  };
}
