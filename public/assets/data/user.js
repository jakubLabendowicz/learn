/* User: the app's single local user (no accounts/auth). */
class UserDao extends Dao {
  constructor() { super('users'); }
}

class UserRepository extends Repository {
  constructor() { super(new UserDao()); }

  // Creates the single local user the first time the app ever runs.
  ensureDefault() {
    if (this.count() > 0) return;
    this.insert({
      id: learnUuid(),
      name: 'Gość',
      email: '',
      bio: '',
      avatarIcon: '🙂',
      createdAt: new Date().toISOString(),
    });
  }

  // This app has exactly one local user — this is them.
  current() {
    return this.all()[0] || null;
  }
}

const userRepository = new UserRepository();
