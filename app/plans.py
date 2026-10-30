"""Plan limits. Edit here to change what each tier gets; admin assigns a plan per client."""
PLANS = {
    "starter": {
        "label": "Starter", "bots": 1, "sources": 10, "max_chars": 200_000,
        "platform_msgs": 300,    # messages/month on YOUR platform LLM keys
        "total_msgs": 1500,      # all visitor messages/month (each costs you an embedding call, even on the client's own key)
        "web_searches": 0,       # Tavily searches/month
        "web_search": False, "premium_models": False, "remove_branding": False,
    },
    "premium": {
        "label": "Premium", "bots": 5, "sources": 100, "max_chars": 3_000_000,
        "platform_msgs": 5000, "total_msgs": 15000, "web_searches": 300,
        "web_search": True, "premium_models": True, "remove_branding": True,
    },
}
CLIENT_PLANS = tuple(PLANS)
OWNER = {
    "label": "Owner", "bots": 50, "sources": 1000, "max_chars": 50_000_000,
    "platform_msgs": 100_000, "total_msgs": 200_000, "web_searches": 5000,
    "web_search": True, "premium_models": True, "remove_branding": True,
}


def plan_for(role: str, plan: str) -> dict:
    return OWNER if role == "admin" else PLANS.get(plan, PLANS["starter"])
