"""Update the owned collection with RWKV-Instant recall estimates."""
import argparse
import hashlib
import sqlite3
import time
from datetime import date
from pathlib import Path

import pandas as pd
import torch
from rwkv.run_as_rnn import RNNProcess


def features(event, when, day, previous, first_day):
    return pd.Series(dict(
        card_id=event['card_id'], note_id=event['note_id'], deck_id=event['deck_id'],
        preset_id=float('nan'), rating=event['rating'], duration=event['duration'],
        state=event['state'], elapsed_days=day-previous['day'] if previous else -1,
        elapsed_seconds=(when-previous['id'])//1000 if previous else -1,
        day_offset=day-first_day,
    ))


@torch.inference_mode()
def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('checkpoint', type=Path)
    parser.add_argument('--device', default='cuda' if torch.cuda.is_available() else 'cpu', choices=['cpu', 'cuda'])
    parser.add_argument('collection', type=Path)
    args = parser.parse_args()
    if hashlib.sha256(args.checkpoint.read_bytes()).hexdigest() != '82d60a4de2e26b4064b86359874e458d1546c0e9651c5dbdf9b8f449a9b97114':
        parser.error('Unexpected benchmark checkpoint')
    torch.manual_seed(42)
    torch.set_num_threads(1)
    model = RNNProcess(args.checkpoint, torch.device(args.device), torch.float32)
    model.rnn.eval()
    history = {}
    first_day = None
    db = sqlite3.connect(args.collection.resolve().as_uri()+'?mode=rw', uri=True)
    db.row_factory = sqlite3.Row
    reviews = db.execute("""
        SELECT r.id, r.card_id, r.ease AS rating, r.kind,
               min(60000, max(0, r.time_ms)) AS duration, c.note_id, d.id AS deck_id
        FROM revlog r JOIN cards c ON c.id=r.card_id JOIN decks d ON d.name=c.deck_name
        WHERE r.ease BETWEEN 1 AND 4 ORDER BY r.id
    """)
    for review in reviews:
        event = dict(review)
        card = event['card_id']
        day = date.fromtimestamp(event['id']/1000).toordinal()
        prior = history.get(card)
        if first_day is None:
            first_day = day
        event['day'] = day
        event['state'] = {0: 1, 1: 2, 2: 3}.get(event['kind'], 2) if prior else 0
        model.process_row(features(event, event['id'], day, prior, first_day))
        history[card] = event

    now = int(time.time()*1000)
    today = date.today()
    day = today.toordinal()
    scores = []
    for card, in db.execute('SELECT id FROM cards WHERE queue=2 AND due_at<=?', (now,)):
        prior = history.get(card)
        if prior and prior['id'] <= now:
            probability = model.imm_predict(features(prior, now, day, prior, first_day)).item()
            if not 0 <= probability <= 1:
                raise ValueError('Invalid recall probability')
            scores.append((card, prior['id'], today.isoformat(), probability))
    with db:
        db.execute('DELETE FROM instant_scores')
        db.executemany('INSERT INTO instant_scores VALUES(?,?,?,?)', scores)
    db.close()
    print(f'Published {len(scores)} review scores for {today}')


if __name__ == '__main__':
    main()
