export interface Song {
  id: string;
  title: string;
  thumbnail: string;
  duration: string;
  author: string;
}

export interface Playlist {
  id: string;
  userId: string;
  name: string;
  songs: Song[];
  createdAt: any;
}

export interface Favorite {
  id: string;
  userId: string;
  song: Song;
  createdAt: any;
}

export interface History {
  id: string;
  userId: string;
  song: Song;
  playedAt: any;
}

export interface ApiKey {
  id: string;
  key: string;
  name: string;
  createdAt: any;
  createdBy: string;
}

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  photoURL: string;
  role: string;
}
