"""
Wordle game service - Discord-like integration.

Features:
- Daily word puzzle for all users
- Personal stats tracking (stored in Redis)
- Share results in chat
- 6 attempts to guess a 5-letter word
"""
import json
import random
from datetime import datetime, timezone, date
from typing import Optional
from dataclasses import dataclass, asdict

from app.infra.redis import get_redis_client
from app.services.wordle_words_ru import WORD_LIST_RU
from app.services.wordle_words_en import WORD_LIST_EN


@dataclass
class WordleGuess:
    """Result of a single guess."""
    word: str
    result: list[str]  # 'correct', 'present', 'absent'


@dataclass
class WordleGame:
    """Current game state."""
    word: str
    guesses: list[WordleGuess]
    max_attempts: int = 6
    won: bool = False
    lost: bool = False
    
    def to_dict(self):
        return {
            "word": self.word,  # Always save the word internally
            "guesses": [asdict(g) for g in self.guesses],
            "max_attempts": self.max_attempts,
            "won": self.won,
            "lost": self.lost,
            "attempts": len(self.guesses),
        }
    
    def to_api_response(self):
        """Return game state for API (hide word until game ends)."""
        return {
            "word": self.word if self.won or self.lost else None,
            "guesses": [asdict(g) for g in self.guesses],
            "max_attempts": self.max_attempts,
            "won": self.won,
            "lost": self.lost,
            "attempts": len(self.guesses),
        }


@dataclass
class WordleStats:
    """Player statistics."""
    played: int = 0
    won: int = 0
    current_streak: int = 0
    max_streak: int = 0
    guess_distribution: dict[int, int] = None  # {1: 0, 2: 0, ... 6: 0}
    
    def __post_init__(self):
        if self.guess_distribution is None:
            self.guess_distribution = {1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0}
        elif isinstance(self.guess_distribution, dict):
            # Convert string keys to int (from JSON)
            self.guess_distribution = {int(k): v for k, v in self.guess_distribution.items()}
    
    def to_dict(self):
        return {
            "played": self.played,
            "won": self.won,
            "win_percentage": round((self.won / self.played * 100) if self.played > 0 else 0, 1),
            "current_streak": self.current_streak,
            "max_streak": self.max_streak,
            "guess_distribution": self.guess_distribution,
        }


def get_daily_word(language: str = "ru") -> str:
    """Get the word for today (same word for all players)."""
    today = date.today()
    # Use date as seed for consistent daily word
    seed = today.year * 10000 + today.month * 100 + today.day
    random.seed(seed)
    
    word_list = WORD_LIST_RU if language == "ru" else WORD_LIST_EN
    return random.choice(word_list)


def get_game_key(user_id: int, language: str = "ru") -> str:
    """Get Redis key for user's game state."""
    today = date.today().isoformat()
    return f"wordle:{language}:{today}:{user_id}"


def get_stats_key(user_id: int, language: str = "ru") -> str:
    """Get Redis key for user's stats."""
    return f"wordle:stats:{language}:{user_id}"


async def get_or_create_game(user_id: int, language: str = "ru") -> WordleGame:
    """Get existing game or create new one for today."""
    key = get_game_key(user_id, language)
    redis = get_redis_client()
    
    if redis:
        try:
            data = await redis.get(key)
            if data:
                game_data = json.loads(data)
                word = game_data.get("word")
                # If word is None (old data), generate the daily word
                if not word:
                    word = get_daily_word(language)
                guesses = [WordleGuess(**g) for g in game_data["guesses"]]
                return WordleGame(
                    word=word,
                    guesses=guesses,
                    won=game_data.get("won", False),
                    lost=game_data.get("lost", False),
                )
        except Exception as e:
            print(f"⚠️ Failed to load Wordle game from Redis: {e}")
    
    # Create new game
    word = get_daily_word(language)
    return WordleGame(word=word, guesses=[])


async def save_game(user_id: int, game: WordleGame, language: str = "ru") -> None:
    """Save game state to Redis."""
    key = get_game_key(user_id, language)
    redis = get_redis_client()
    if redis:
        try:
            # Expire at end of day
            now = datetime.now(timezone.utc)
            end_of_day = datetime(now.year, now.month, now.day, 23, 59, 59, tzinfo=timezone.utc)
            ttl = int((end_of_day - now).total_seconds()) + 60  # Add 1 minute buffer
            
            await redis.setex(key, ttl, json.dumps(game.to_dict()))
        except Exception as e:
            print(f"⚠️ Failed to save Wordle game: {e}")


async def get_stats(user_id: int, language: str = "ru") -> WordleStats:
    """Get player statistics."""
    key = get_stats_key(user_id, language)
    redis = get_redis_client()
    
    if redis:
        try:
            data = await redis.get(key)
            if data:
                stats_data = json.loads(data)
                return WordleStats(**stats_data)
        except Exception as e:
            print(f"⚠️ Failed to load Wordle stats: {e}")
    
    return WordleStats()


async def save_stats(user_id: int, stats: WordleStats, language: str = "ru") -> None:
    """Save player statistics."""
    key = get_stats_key(user_id, language)
    redis = get_redis_client()
    if redis:
        try:
            # Stats persist for 1 year
            await redis.setex(key, 365 * 24 * 60 * 60, json.dumps(stats.to_dict()))
        except Exception as e:
            print(f"⚠️ Failed to save Wordle stats: {e}")


def check_guess(word: str, guess: str) -> WordleGuess:
    """Check a guess against the target word and return result."""
    guess = guess.upper().strip()
    word = (word or "").upper()
    
    result = ["absent"] * 5
    word_chars = list(word)
    guess_chars = list(guess)
    
    # First pass: mark correct positions
    for i in range(5):
        if i < len(guess_chars) and i < len(word_chars) and guess_chars[i] == word_chars[i]:
            result[i] = "correct"
            word_chars[i] = None  # Mark as used
    
    # Second pass: mark present (wrong position)
    for i in range(5):
        if result[i] == "absent" and i < len(guess_chars):
            if guess_chars[i] in word_chars:
                result[i] = "present"
                # Mark as used
                idx = word_chars.index(guess_chars[i])
                word_chars[idx] = None
    
    return WordleGuess(word=guess, result=result)


async def make_guess(user_id: int, guess: str, language: str = "ru") -> tuple[WordleGame, bool]:
    """
    Make a guess in the game.
    Returns (game_state, is_new_guess) - is_new_guess is False if already guessed.
    """
    game = await get_or_create_game(user_id, language)
    
    if game.won or game.lost:
        return game, False
    
    guess = guess.upper().strip()
    
    # Check if already guessed
    for g in game.guesses:
        if g.word == guess:
            return game, False
    
    # Validate guess length
    if len(guess) != 5:
        return game, False
    
    # Check the guess
    guess_result = check_guess(game.word, guess)
    game.guesses.append(guess_result)
    
    # Check win/lose
    if guess_result.result == ["correct"] * 5:
        game.won = True
    elif len(game.guesses) >= game.max_attempts:
        game.lost = True
    
    # Save game
    await save_game(user_id, game, language)
    
    # Update stats if game ended
    if game.won or game.lost:
        stats = await get_stats(user_id, language)
        stats.played += 1
        
        if game.won:
            stats.won += 1
            stats.current_streak += 1
            stats.max_streak = max(stats.max_streak, stats.current_streak)
            stats.guess_distribution[len(game.guesses)] = stats.guess_distribution.get(len(game.guesses), 0) + 1
        else:
            stats.current_streak = 0
        
        await save_stats(user_id, stats, language)
    
    return game, True


def generate_share_text(game: WordleGame, language: str = "ru") -> str:
    """Generate shareable result text like Discord's Wordle."""
    emoji_map = {
        "correct": "🟩",
        "present": "🟨", 
        "absent": "⬛",
    }
    
    lines = [f"Wordle {language.upper()} {date.today().isoformat()}"]
    if game.won:
        lines[0] += f" {len(game.guesses)}/6"
    else:
        lines[0] += " X/6"
    
    for guess in game.guesses:
        line = "".join(emoji_map[r] for r in guess.result)
        lines.append(line)
    
    return "\n".join(lines)


def is_valid_word(word: str, language: str = "ru") -> bool:
    """Check if word is in the valid word list."""
    word = word.upper().strip()
    word_list = WORD_LIST_RU if language == "ru" else WORD_LIST_EN
    return word in word_list or len(word) == 5  # Allow any 5-letter word
