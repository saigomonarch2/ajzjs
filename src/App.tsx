import React, { useState, useEffect, createContext, useContext, useRef } from 'react';
import { auth, db, signInWithGoogle, handleFirestoreError, OperationType } from './firebase';
import { onAuthStateChanged, User, signOut } from 'firebase/auth';
import { collection, onSnapshot, query, where, addDoc, deleteDoc, doc, serverTimestamp, setDoc, getDocFromServer } from 'firebase/firestore';
import { Song, Playlist, Favorite, History, ApiKey } from './types';
import { 
  Play, Pause, SkipBack, SkipForward, Search, Heart, ListMusic, 
  Plus, LogIn, LogOut, Music, Trash2, Import, X, Volume2, 
  LayoutGrid, Library, Settings, Menu, Clock, Shield, Key, Copy, Check
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { BrowserRouter, Routes, Route, useNavigate, useParams, useLocation } from 'react-router-dom';
import YouTube from 'react-youtube';
import axios from 'axios';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// Utility for tailwind classes
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Context for global state
interface AppContextType {
  user: User | null;
  loading: boolean;
  currentSong: Song | null;
  setCurrentSong: (song: Song | null) => void;
  isPlaying: boolean;
  setIsPlaying: (playing: boolean) => void;
  playlists: Playlist[];
  favorites: Favorite[];
  history: History[];
  apiKeys: ApiKey[];
  queue: Song[];
  setQueue: (songs: Song[]) => void;
  addToQueue: (song: Song) => void;
  removeFromQueue: (songId: string) => void;
  addToFavorites: (song: Song) => Promise<void>;
  removeFromFavorites: (songId: string) => Promise<void>;
  createPlaylist: (name: string) => Promise<void>;
  addToPlaylist: (playlistId: string, song: Song) => Promise<void>;
  removeFromPlaylist: (playlistId: string, songId: string) => Promise<void>;
  deletePlaylist: (playlistId: string) => Promise<void>;
  importPlaylist: (url: string) => Promise<void>;
  setShowPlaylistModal: (show: boolean) => void;
  setShowImportModal: (show: boolean) => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used within AppProvider');
  return context;
};

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<CMusicApp />} />
        <Route path="/play/:videoId" element={<CMusicApp />} />
      </Routes>
    </BrowserRouter>
  );
}

function CMusicApp() {
  const [user, setUser] = useState<User | null>(null);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentSong, setCurrentSong] = useState<Song | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [history, setHistory] = useState<History[]>([]);
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [queue, setQueue] = useState<Song[]>([]);
  const [activeTab, setActiveTab] = useState<'search' | 'playlists' | 'favorites' | 'history' | 'admin'>('search');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Song[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [importUrl, setImportUrl] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [showPlaylistModal, setShowPlaylistModal] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [showApiKeyModal, setShowApiKeyModal] = useState(false);
  const [newApiKeyName, setNewApiKeyName] = useState('');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const playerRef = useRef<any>(null);
  const [playerReady, setPlayerReady] = useState(false);
  const [playerError, setPlayerError] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [showDetailsModal, setShowDetailsModal] = useState(false);

  const navigate = useNavigate();
  const location = useLocation();
  const { videoId } = useParams();

  const isAdmin = user && (
    user.email === "shubhamnm671@gmail.com" || 
    user.email === "saigomonarch0@gmail.com" ||
    userRole === 'admin'
  );

  // Sync currentSong with URL
  useEffect(() => {
    if (currentSong) {
      if (location.pathname !== `/play/${currentSong.id}`) {
        navigate(`/play/${currentSong.id}`, { replace: true });
      }
    }
  }, [currentSong, navigate, location.pathname]);

  // Track player progress
  useEffect(() => {
    let interval: any;
    if (isPlaying && playerReady && playerRef.current) {
      interval = setInterval(() => {
        const time = playerRef.current.getCurrentTime();
        const dur = playerRef.current.getDuration();
        setCurrentTime(time);
        setDuration(dur);
      }, 500);
    } else {
      clearInterval(interval);
    }
    return () => clearInterval(interval);
  }, [isPlaying, playerReady]);

  const formatTime = (seconds: number) => {
    if (!seconds || isNaN(seconds)) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!playerRef.current || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percentage = x / rect.width;
    const seekTime = percentage * duration;
    playerRef.current.seekTo(seekTime, true);
    setCurrentTime(seekTime);
  };

  // Load song from URL on initial load
  useEffect(() => {
    const loadFromUrl = async () => {
      const pathParts = location.pathname.split('/');
      if (pathParts[1] === 'play' && pathParts[2]) {
        const vidId = pathParts[2];
        if (!currentSong || currentSong.id !== vidId) {
          try {
            const response = await axios.get(`/api/song/${vidId}`);
            setCurrentSong(response.data);
            setIsPlaying(true); // Enable autoplay when loading from URL
          } catch (error) {
            console.error("Failed to load song from URL:", error);
          }
        }
      }
    };
    loadFromUrl();
  }, [location.pathname]);

  // Auth listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setUser(user);
      setLoading(false);
      
      if (user) {
        // Sync user profile to Firestore and fetch role
        try {
          const userDocRef = doc(db, 'users', user.uid);
          const userDoc = await getDocFromServer(userDocRef);
          
          if (userDoc.exists()) {
            setUserRole(userDoc.data().role || 'user');
          } else {
            setUserRole('user');
          }

          await setDoc(userDocRef, {
            uid: user.uid,
            email: user.email,
            displayName: user.displayName,
            photoURL: user.photoURL,
          }, { merge: true });
        } catch (error) {
          console.error("Failed to sync user profile:", error);
        }
      } else {
        setUserRole(null);
      }
    });
    return unsubscribe;
  }, []);

  // Data listeners
  useEffect(() => {
    if (!user) {
      setPlaylists([]);
      setFavorites([]);
      setHistory([]);
      setApiKeys([]);
      return;
    }

    const playlistsQuery = query(collection(db, 'playlists'), where('userId', '==', user.uid));
    const unsubscribePlaylists = onSnapshot(playlistsQuery, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Playlist));
      setPlaylists(data);
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'playlists'));

    const favoritesQuery = query(collection(db, 'favorites'), where('userId', '==', user.uid));
    const unsubscribeFavorites = onSnapshot(favoritesQuery, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Favorite));
      setFavorites(data);
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'favorites'));

    const historyQuery = query(collection(db, 'history'), where('userId', '==', user.uid));
    const unsubscribeHistory = onSnapshot(historyQuery, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as History));
      // Sort history by playedAt descending
      const sortedData = data.sort((a, b) => {
        const timeA = a.playedAt?.toMillis?.() || 0;
        const timeB = b.playedAt?.toMillis?.() || 0;
        return timeB - timeA;
      });
      setHistory(sortedData);
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'history'));

    let unsubscribeApiKeys = () => {};
    if (isAdmin) {
      const apiKeysQuery = query(collection(db, 'apiKeys'));
      unsubscribeApiKeys = onSnapshot(apiKeysQuery, (snapshot) => {
        const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ApiKey));
        setApiKeys(data);
      }, (error) => handleFirestoreError(error, OperationType.LIST, 'apiKeys'));
    }

    return () => {
      unsubscribePlaylists();
      unsubscribeFavorites();
      unsubscribeHistory();
      unsubscribeApiKeys();
    };
  }, [user, isAdmin]);

  // Add to history when song starts playing
  useEffect(() => {
    if (user && currentSong && isPlaying) {
      const addToHistory = async () => {
        try {
          // Check if the last history entry is the same song to avoid duplicates
          if (history.length > 0 && history[0].song.id === currentSong.id) {
            return;
          }

          await addDoc(collection(db, 'history'), {
            userId: user.uid,
            song: currentSong,
            playedAt: serverTimestamp()
          });
        } catch (error) {
          console.error("Failed to add to history:", error);
        }
      };
      addToHistory();
    }
  }, [currentSong, isPlaying, user]);

  // Sync player state
  useEffect(() => {
    const syncPlayer = () => {
      if (playerRef.current && typeof playerRef.current.playVideo === 'function') {
        try {
          const state = playerRef.current.getPlayerState();
          if (isPlaying) {
            if (state !== 1 && state !== 3) { // 1: playing, 3: buffering
              playerRef.current.playVideo();
            }
          } else {
            if (state !== 2) { // 2: paused
              playerRef.current.pauseVideo();
            }
          }
        } catch (err) {
          // Ignore errors during sync
        }
      }
    };
    syncPlayer();
  }, [isPlaying, currentSong, playerReady]);

  // Initial search for trending music
  useEffect(() => {
    const fetchInitialMusic = async () => {
      setIsSearching(true);
      try {
        const response = await axios.get('/api/search?q=trending%20music');
        if (Array.isArray(response.data)) {
          setSearchResults(response.data);
        }
      } catch (error) {
        console.error("Initial search error:", error);
      } finally {
        setIsSearching(false);
      }
    };
    fetchInitialMusic();
  }, []);

  const handleSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!searchQuery.trim()) return;

    console.log(`Frontend: Searching for "${searchQuery}"...`);
    setIsSearching(true);
    try {
      const response = await axios.get(`/api/search?q=${encodeURIComponent(searchQuery)}`);
      console.log(`Frontend: Search results received:`, response.data);
      if (Array.isArray(response.data)) {
        setSearchResults(response.data);
      } else {
        console.error("Frontend: Search results are not an array:", response.data);
        setSearchResults([]);
      }
      setActiveTab('search');
    } catch (error) {
      console.error("Frontend: Search error:", error);
    } finally {
      setIsSearching(false);
    }
  };

  const addToFavorites = async (song: Song) => {
    if (!user) return;
    try {
      await addDoc(collection(db, 'favorites'), {
        userId: user.uid,
        song,
        createdAt: serverTimestamp()
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'favorites');
    }
  };

  const removeFromFavorites = async (songId: string) => {
    if (!user) return;
    const favorite = favorites.find(f => f.song.id === songId);
    if (!favorite) return;
    try {
      await deleteDoc(doc(db, 'favorites', favorite.id));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, 'favorites');
    }
  };

  const createPlaylist = async (name: string) => {
    if (!user) return;
    try {
      await addDoc(collection(db, 'playlists'), {
        userId: user.uid,
        name,
        songs: [],
        createdAt: serverTimestamp()
      });
      setNewPlaylistName('');
      setShowPlaylistModal(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'playlists');
    }
  };

  const addToPlaylist = async (playlistId: string, song: Song) => {
    if (!user) return;
    const playlist = playlists.find(p => p.id === playlistId);
    if (!playlist) return;
    
    // Check if song already in playlist
    if (playlist.songs.some(s => s.id === song.id)) return;

    try {
      await setDoc(doc(db, 'playlists', playlistId), {
        ...playlist,
        songs: [...playlist.songs, song]
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'playlists');
    }
  };

  const removeFromPlaylist = async (playlistId: string, songId: string) => {
    if (!user) return;
    const playlist = playlists.find(p => p.id === playlistId);
    if (!playlist) return;

    try {
      await setDoc(doc(db, 'playlists', playlistId), {
        ...playlist,
        songs: playlist.songs.filter(s => s.id !== songId)
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'playlists');
    }
  };

  const deletePlaylist = async (playlistId: string) => {
    if (!user) return;
    try {
      await deleteDoc(doc(db, 'playlists', playlistId));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, 'playlists');
    }
  };

  const handleImportPlaylist = async (urlOverride?: any) => {
    const urlToImport = typeof urlOverride === 'string' ? urlOverride : importUrl;
    if (!user || !urlToImport.trim()) return;
    
    console.log(`Frontend: Importing playlist from URL: "${urlToImport}"`);
    setIsImporting(true);
    setImportError(null);
    try {
      const response = await axios.get(`/api/playlist?url=${encodeURIComponent(urlToImport)}`);
      console.log(`Frontend: Playlist data received:`, response.data);
      const { title, songs } = response.data;
      
      if (!songs || songs.length === 0) {
        throw new Error("This playlist is empty or could not be read.");
      }

      console.log(`Frontend: Adding playlist "${title}" with ${songs.length} songs to Firestore...`);
      await addDoc(collection(db, 'playlists'), {
        userId: user.uid,
        name: title || "Imported Playlist",
        songs: songs,
        createdAt: serverTimestamp()
      });
      
      console.log(`Frontend: Playlist imported successfully!`);
      setImportUrl('');
      setShowImportModal(false);
    } catch (error: any) {
      console.error("Frontend: Import error:", error);
      const message = error.response?.data?.error || error.message || "Failed to import playlist";
      setImportError(message);
    } finally {
      setIsImporting(false);
    }
  };

  const addToQueue = (song: Song) => {
    if (queue.some(s => s.id === song.id)) return;
    setQueue([...queue, song]);
  };

  const removeFromQueue = (songId: string) => {
    setQueue(queue.filter(s => s.id !== songId));
  };

  const playNext = () => {
    if (queue.length > 0) {
      const nextSong = queue[0];
      setCurrentSong(nextSong);
      setQueue(queue.slice(1));
    }
  };

  const generateApiKey = async (name: string) => {
    if (!user || !isAdmin) return;
    const key = `sk_${Math.random().toString(36).substring(2, 15)}${Math.random().toString(36).substring(2, 15)}`;
    try {
      await addDoc(collection(db, 'apiKeys'), {
        key,
        name,
        createdAt: serverTimestamp(),
        createdBy: user.uid
      });
      setNewApiKeyName('');
      setShowApiKeyModal(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'apiKeys');
    }
  };

  const deleteApiKey = async (id: string) => {
    if (!isAdmin) return;
    try {
      await deleteDoc(doc(db, 'apiKeys', id));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, 'apiKeys');
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(text);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const contextValue: AppContextType = {
    user,
    loading,
    currentSong,
    setCurrentSong,
    isPlaying,
    setIsPlaying,
    playlists,
    favorites,
    history,
    apiKeys,
    queue,
    setQueue,
    addToQueue,
    removeFromQueue,
    addToFavorites,
    removeFromFavorites,
    createPlaylist,
    addToPlaylist,
    removeFromPlaylist,
    deletePlaylist,
    importPlaylist: async (url) => { setImportUrl(url); await handleImportPlaylist(url); },
    setShowPlaylistModal,
    setShowImportModal
  };

  if (loading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-[#0a0502]">
        <motion.div 
          animate={{ scale: [1, 1.2, 1], rotate: [0, 360] }}
          transition={{ duration: 2, repeat: Infinity }}
          className="text-[#ff4e00]"
        >
          <Music size={48} />
        </motion.div>
      </div>
    );
  }

  return (
    <AppContext.Provider value={contextValue}>
      <div className="h-screen flex flex-col bg-[#0a0502] text-white relative overflow-hidden">
        <div className="atmosphere" />
        
        {/* Header */}
        <header className="h-16 flex items-center justify-between px-4 sm:px-6 z-30 glass border-b-0 sticky top-0">
          <div className="flex items-center gap-2 sm:gap-3">
            <button 
              onClick={() => setShowMobileMenu(true)}
              className="p-2 hover:bg-white/5 rounded-lg lg:hidden text-white/60"
            >
              <Menu size={20} />
            </button>
            <div className="w-8 h-8 sm:w-10 sm:h-10 bg-[#ff4e00] rounded-lg sm:rounded-xl flex items-center justify-center shadow-lg shadow-[#ff4e00]/20">
              <Music size={18} className="text-white sm:hidden" />
              <Music size={24} className="text-white hidden sm:block" />
            </div>
            <h1 className="text-lg sm:text-xl font-bold tracking-tight font-serif italic hidden xs:block">CMusic</h1>
          </div>

          <div className="flex-1 max-w-2xl mx-2 sm:mx-12">
            <form onSubmit={handleSearch} className="relative">
              <Search className="absolute left-3 sm:left-4 top-1/2 -translate-y-1/2 text-white/40" size={16} />
              <input 
                type="text" 
                placeholder="Search..."
                className="w-full bg-white/5 border border-white/10 rounded-full py-2 pl-10 pr-4 focus:outline-none focus:ring-2 focus:ring-[#ff4e00]/50 transition-all placeholder:text-white/20 text-sm"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </form>
          </div>

          <div className="flex items-center gap-2 sm:gap-4">
            {user ? (
              <div className="flex items-center gap-2 sm:gap-3">
                <div className="text-right hidden md:block">
                  <p className="text-sm font-medium">{user.displayName}</p>
                  <p className="text-[10px] text-white/40 uppercase tracking-widest">Premium</p>
                </div>
                <img src={user.photoURL || ''} alt="" className="w-8 h-8 sm:w-10 sm:h-10 rounded-full border border-white/10" />
                <button onClick={() => signOut(auth)} className="p-2 hover:bg-white/5 rounded-full text-white/60 hover:text-white transition-colors hidden sm:block">
                  <LogOut size={20} />
                </button>
              </div>
            ) : (
              <button 
                onClick={signInWithGoogle}
                className="flex items-center gap-2 bg-white text-black px-3 sm:px-5 py-1.5 sm:py-2 rounded-full text-sm font-semibold hover:bg-white/90 transition-all"
              >
                <LogIn size={16} className="sm:hidden" />
                <LogIn size={18} className="hidden sm:block" />
                <span className="hidden xs:block">Sign In</span>
              </button>
            )}
          </div>
        </header>

        <div className="flex-1 flex overflow-hidden relative">
          {/* Sidebar - Desktop */}
          <aside className="w-64 glass border-r-0 hidden lg:flex flex-col p-4 z-10">
            <nav className="space-y-1 mb-8">
              <SidebarItem 
                icon={<LayoutGrid size={20} />} 
                label="Explore" 
                active={activeTab === 'search'} 
                onClick={() => setActiveTab('search')}
              />
              <SidebarItem 
                icon={<Library size={20} />} 
                label="Your Library" 
                active={activeTab === 'playlists'} 
                onClick={() => setActiveTab('playlists')}
              />
              <SidebarItem 
                icon={<Heart size={20} />} 
                label="Favorites" 
                active={activeTab === 'favorites'} 
                onClick={() => setActiveTab('favorites')}
              />
              <SidebarItem 
                icon={<Clock size={20} />} 
                label="History" 
                active={activeTab === 'history'} 
                onClick={() => setActiveTab('history')}
              />
              {isAdmin && (
                <SidebarItem 
                  icon={<Shield size={20} />} 
                  label="Admin Panel" 
                  active={activeTab === 'admin'} 
                  onClick={() => setActiveTab('admin')}
                />
              )}
            </nav>

            <div className="flex-1 overflow-y-auto custom-scrollbar">
              <div className="flex items-center justify-between mb-4 px-2">
                <h3 className="text-[10px] font-bold text-white/30 uppercase tracking-[0.2em]">Playlists</h3>
                <div className="flex gap-1">
                  <button onClick={() => setShowImportModal(true)} className="p-1 hover:bg-white/5 rounded text-white/40 hover:text-white transition-colors" title="Import from YouTube">
                    <Import size={14} />
                  </button>
                  <button onClick={() => setShowPlaylistModal(true)} className="p-1 hover:bg-white/5 rounded text-white/40 hover:text-white transition-colors" title="New Playlist">
                    <Plus size={14} />
                  </button>
                </div>
              </div>
              
              <div className="space-y-1">
                {playlists.map(playlist => (
                  <button 
                    key={playlist.id}
                    onClick={() => { setActiveTab('playlists'); }}
                    className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-white/60 hover:text-white hover:bg-white/5 transition-all text-left"
                  >
                    <ListMusic size={16} className="text-[#ff4e00]/60" />
                    <span className="truncate">{playlist.name}</span>
                  </button>
                ))}
              </div>
            </div>
          </aside>

          {/* Mobile Menu Overlay */}
          <AnimatePresence>
            {showMobileMenu && (
              <>
                <motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onClick={() => setShowMobileMenu(false)}
                  className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 lg:hidden"
                />
                <motion.aside 
                  initial={{ x: '-100%' }}
                  animate={{ x: 0 }}
                  exit={{ x: '-100%' }}
                  className="fixed top-0 left-0 bottom-0 w-72 glass z-50 lg:hidden p-6 flex flex-col"
                >
                  <div className="flex items-center justify-between mb-8">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-[#ff4e00] rounded-lg flex items-center justify-center">
                        <Music size={18} className="text-white" />
                      </div>
                      <h1 className="text-lg font-bold font-serif italic">CMusic</h1>
                    </div>
                    <button onClick={() => setShowMobileMenu(false)} className="p-2 text-white/40">
                      <X size={20} />
                    </button>
                  </div>

                  <nav className="space-y-2 mb-8">
                    <SidebarItem 
                      icon={<LayoutGrid size={20} />} 
                      label="Explore" 
                      active={activeTab === 'search'} 
                      onClick={() => { setActiveTab('search'); setShowMobileMenu(false); }}
                    />
                    <SidebarItem 
                      icon={<Library size={20} />} 
                      label="Your Library" 
                      active={activeTab === 'playlists'} 
                      onClick={() => { setActiveTab('playlists'); setShowMobileMenu(false); }}
                    />
                    <SidebarItem 
                      icon={<Heart size={20} />} 
                      label="Favorites" 
                      active={activeTab === 'favorites'} 
                      onClick={() => { setActiveTab('favorites'); setShowMobileMenu(false); }}
                    />
                    <SidebarItem 
                      icon={<Clock size={20} />} 
                      label="History" 
                      active={activeTab === 'history'} 
                      onClick={() => { setActiveTab('history'); setShowMobileMenu(false); }}
                    />
                    {isAdmin && (
                      <SidebarItem 
                        icon={<Shield size={20} />} 
                        label="Admin Panel" 
                        active={activeTab === 'admin'} 
                        onClick={() => { setActiveTab('admin'); setShowMobileMenu(false); }}
                      />
                    )}
                  </nav>

                  <div className="flex-1 overflow-y-auto custom-scrollbar">
                    <div className="flex items-center justify-between mb-4 px-2">
                      <h3 className="text-[10px] font-bold text-white/30 uppercase tracking-[0.2em]">Playlists</h3>
                      <div className="flex gap-2">
                        <button onClick={() => { setShowImportModal(true); setShowMobileMenu(false); }} className="p-1 text-white/40">
                          <Import size={16} />
                        </button>
                        <button onClick={() => { setShowPlaylistModal(true); setShowMobileMenu(false); }} className="p-1 text-white/40">
                          <Plus size={16} />
                        </button>
                      </div>
                    </div>
                    <div className="space-y-1">
                      {playlists.map(playlist => (
                        <button 
                          key={playlist.id}
                          onClick={() => { setActiveTab('playlists'); setShowMobileMenu(false); }}
                          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-white/60 text-left"
                        >
                          <ListMusic size={16} className="text-[#ff4e00]/60" />
                          <span className="truncate">{playlist.name}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {user && (
                    <button 
                      onClick={() => signOut(auth)}
                      className="mt-auto flex items-center gap-3 px-4 py-3 rounded-xl text-white/40 hover:text-white hover:bg-white/5 transition-all"
                    >
                      <LogOut size={20} />
                      <span className="font-semibold">Sign Out</span>
                    </button>
                  )}
                </motion.aside>
              </>
            )}
          </AnimatePresence>

          {/* Main Content */}
          <main className="flex-1 overflow-y-auto custom-scrollbar p-4 sm:p-8 z-0">
            <AnimatePresence mode="wait">
              {activeTab === 'search' && (
                <motion.div 
                  key="search"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                >
                  <h2 className="text-2xl sm:text-4xl font-serif italic mb-6 sm:mb-8">
                    {searchQuery ? `Results for "${searchQuery}"` : "Discover New Music"}
                  </h2>
                  
                  {isSearching ? (
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 sm:gap-6">
                      {[...Array(10)].map((_, i) => (
                        <div key={i} className="animate-pulse">
                          <div className="aspect-square bg-white/5 rounded-2xl mb-4" />
                          <div className="h-4 bg-white/5 rounded w-3/4 mb-2" />
                          <div className="h-3 bg-white/5 rounded w-1/2" />
                        </div>
                      ))}
                    </div>
                  ) : searchResults.length > 0 ? (
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 sm:gap-6">
                      {searchResults.map(song => (
                        <SongCard key={song.id} song={song} />
                      ))}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-20 text-center">
                      <div className="w-16 h-16 bg-white/5 rounded-full flex items-center justify-center mb-4">
                        <Search size={32} className="text-white/20" />
                      </div>
                      <h3 className="text-xl font-bold mb-2">No results found</h3>
                      <p className="text-white/40 max-w-xs">
                        We couldn't find any songs matching your search. Try different keywords or check your spelling.
                      </p>
                    </div>
                  )}
                </motion.div>
              )}

              {activeTab === 'playlists' && (
                <motion.div 
                  key="playlists"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-8 gap-4">
                    <h2 className="text-2xl sm:text-4xl font-serif italic">Your Playlists</h2>
                    <button 
                      onClick={() => setShowImportModal(true)}
                      className="flex items-center justify-center gap-2 bg-[#ff4e00] text-white px-4 py-2 rounded-full text-sm font-semibold hover:bg-[#ff4e00]/90 transition-all"
                    >
                      <Import size={16} />
                      <span>Import from YouTube</span>
                    </button>
                  </div>

                  {playlists.length === 0 ? (
                    <div className="text-center py-12 sm:py-20 bg-white/5 rounded-3xl border border-dashed border-white/10">
                      <ListMusic size={48} className="mx-auto mb-4 text-white/20" />
                      <p className="text-white/40">You haven't created any playlists yet.</p>
                      <button 
                        onClick={() => setShowPlaylistModal(true)}
                        className="mt-4 text-[#ff4e00] hover:underline font-medium"
                      >
                        Create your first playlist
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-12">
                      {playlists.map(playlist => (
                        <div key={playlist.id}>
                          <div className="flex items-center justify-between mb-6">
                            <div className="flex items-center gap-4">
                              <div className="w-10 h-10 sm:w-12 sm:h-12 bg-white/5 rounded-xl flex items-center justify-center">
                                <ListMusic size={20} className="text-[#ff4e00] sm:hidden" />
                                <ListMusic size={24} className="text-[#ff4e00] hidden sm:block" />
                              </div>
                              <div>
                                <h3 className="text-xl sm:text-2xl font-bold">{playlist.name}</h3>
                                <p className="text-xs sm:text-sm text-white/40">{playlist.songs.length} songs</p>
                              </div>
                            </div>
                            <button 
                              onClick={() => deletePlaylist(playlist.id)}
                              className="p-2 hover:bg-red-500/10 text-white/20 hover:text-red-500 rounded-full transition-all"
                            >
                              <Trash2 size={18} />
                            </button>
                          </div>
                          
                          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 sm:gap-6">
                            {playlist.songs.map(song => (
                              <SongCard key={song.id} song={song} playlistId={playlist.id} />
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </motion.div>
              )}

              {activeTab === 'favorites' && (
                <motion.div 
                  key="favorites"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                >
                  <h2 className="text-2xl sm:text-4xl font-serif italic mb-8">Favorite Songs</h2>
                  
                  {favorites.length === 0 ? (
                    <div className="text-center py-12 sm:py-20 bg-white/5 rounded-3xl border border-dashed border-white/10">
                      <Heart size={48} className="mx-auto mb-4 text-white/20" />
                      <p className="text-white/40">No favorite songs yet.</p>
                      <button 
                        onClick={() => setActiveTab('search')}
                        className="mt-4 text-[#ff4e00] hover:underline font-medium"
                      >
                        Find some music
                      </button>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 sm:gap-6">
                      {favorites.map(fav => (
                        <SongCard key={fav.id} song={fav.song} />
                      ))}
                    </div>
                  )}
                </motion.div>
              )}

              {activeTab === 'history' && (
                <motion.div 
                  key="history"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                >
                  <h2 className="text-2xl sm:text-4xl font-serif italic mb-8">Play History</h2>
                  
                  {history.length === 0 ? (
                    <div className="text-center py-12 sm:py-20 bg-white/5 rounded-3xl border border-dashed border-white/10">
                      <Clock size={48} className="mx-auto mb-4 text-white/20" />
                      <p className="text-white/40">Your play history is empty.</p>
                      <button 
                        onClick={() => setActiveTab('search')}
                        className="mt-4 text-[#ff4e00] hover:underline font-medium"
                      >
                        Start listening
                      </button>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 sm:gap-6">
                      {history.map(h => (
                        <SongCard key={h.id} song={h.song} />
                      ))}
                    </div>
                  )}
                </motion.div>
              )}

              {activeTab === 'admin' && isAdmin && (
                <motion.div 
                  key="admin"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-8 gap-4">
                    <h2 className="text-2xl sm:text-4xl font-serif italic">Admin Panel</h2>
                    <button 
                      onClick={() => setShowApiKeyModal(true)}
                      className="flex items-center justify-center gap-2 bg-[#ff4e00] text-white px-4 py-2 rounded-full text-sm font-semibold hover:bg-[#ff4e00]/90 transition-all"
                    >
                      <Plus size={16} />
                      <span>Generate API Key</span>
                    </button>
                  </div>

                  <div className="glass rounded-3xl overflow-hidden border border-white/10">
                    <div className="p-6 border-b border-white/10 bg-white/5">
                      <h3 className="text-lg font-bold flex items-center gap-2">
                        <Key size={20} className="text-[#ff4e00]" />
                        API Keys
                      </h3>
                      <p className="text-sm text-white/40 mt-1">Manage API keys for external streaming integrations.</p>
                    </div>
                    
                    <div className="overflow-x-auto">
                      <table className="w-full text-left">
                        <thead>
                          <tr className="border-b border-white/10 text-[10px] uppercase tracking-widest text-white/30">
                            <th className="px-6 py-4 font-bold">Name</th>
                            <th className="px-6 py-4 font-bold">Key</th>
                            <th className="px-6 py-4 font-bold">Created</th>
                            <th className="px-6 py-4 font-bold text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                          {apiKeys.length === 0 ? (
                            <tr>
                              <td colSpan={4} className="px-6 py-12 text-center text-white/20 italic">
                                No API keys generated yet.
                              </td>
                            </tr>
                          ) : (
                            apiKeys.map(apiKey => (
                              <tr key={apiKey.id} className="hover:bg-white/5 transition-colors">
                                <td className="px-6 py-4">
                                  <span className="font-semibold text-sm">{apiKey.name}</span>
                                </td>
                                <td className="px-6 py-4">
                                  <div className="flex items-center gap-2">
                                    <code className="bg-black/40 px-2 py-1 rounded text-xs font-mono text-white/60">
                                      {apiKey.key.substring(0, 8)}...{apiKey.key.substring(apiKey.key.length - 4)}
                                    </code>
                                    <button 
                                      onClick={() => copyToClipboard(apiKey.key)}
                                      className="p-1.5 hover:bg-white/10 rounded-lg text-white/40 hover:text-white transition-all"
                                    >
                                      {copiedKey === apiKey.key ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
                                    </button>
                                  </div>
                                </td>
                                <td className="px-6 py-4 text-xs text-white/40">
                                  {apiKey.createdAt?.toDate?.().toLocaleDateString() || 'Just now'}
                                </td>
                                <td className="px-6 py-4 text-right">
                                  <button 
                                    onClick={() => deleteApiKey(apiKey.id)}
                                    className="p-2 hover:bg-red-500/10 text-white/20 hover:text-red-500 rounded-lg transition-all"
                                  >
                                    <Trash2 size={16} />
                                  </button>
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="mt-12 grid grid-cols-1 lg:grid-cols-3 gap-6">
                    <div className="glass p-8 rounded-3xl border border-white/10 lg:col-span-2">
                      <h3 className="text-xl font-bold mb-6 flex items-center gap-2">
                        <Shield size={22} className="text-[#ff4e00]" />
                        API Documentation
                      </h3>
                      <div className="space-y-6">
                        <div className="p-6 bg-white/5 rounded-2xl border border-white/5">
                          <div className="flex items-center justify-between mb-2">
                            <h4 className="font-bold text-sm text-[#ff4e00]">Search Music</h4>
                            <span className="text-[10px] bg-green-500/20 text-green-400 px-2 py-0.5 rounded-full font-bold uppercase">GET</span>
                          </div>
                          <code className="block bg-black/40 p-3 rounded-xl text-xs font-mono text-white/60 mb-3 break-all">
                            {window.location.origin}/api/v1/search?q=query
                          </code>
                          <p className="text-xs text-white/40">Returns a list of songs matching the query. Requires <code className="text-[#ff4e00]">x-api-key</code> header.</p>
                        </div>

                        <div className="p-6 bg-white/5 rounded-2xl border border-white/5">
                          <div className="flex items-center justify-between mb-2">
                            <h4 className="font-bold text-sm text-[#ff4e00]">Get Song Details</h4>
                            <span className="text-[10px] bg-green-500/20 text-green-400 px-2 py-0.5 rounded-full font-bold uppercase">GET</span>
                          </div>
                          <code className="block bg-black/40 p-3 rounded-xl text-xs font-mono text-white/60 mb-3 break-all">
                            {window.location.origin}/api/v1/song/:videoId
                          </code>
                          <p className="text-xs text-white/40">Returns details and stream URL for a specific video ID. Requires <code className="text-[#ff4e00]">x-api-key</code> header.</p>
                        </div>

                        <div className="p-4 bg-[#ff4e00]/10 border border-[#ff4e00]/20 rounded-2xl">
                          <p className="text-xs text-[#ff4e00] font-bold mb-1 italic">Quick Example (cURL):</p>
                          <code className="block bg-black/40 p-3 rounded-xl text-[10px] font-mono text-white/60 break-all">
                            curl -H "x-api-key: YOUR_KEY" "{window.location.origin}/api/v1/search?q=lofi"
                          </code>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-6">
                      <div className="glass p-8 rounded-3xl border border-white/10">
                        <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
                          <Settings size={22} className="text-[#ff4e00]" />
                          System Status
                        </h3>
                        <div className="space-y-4">
                          <div className="flex items-center justify-between p-4 bg-white/5 rounded-2xl">
                            <span className="text-sm text-white/60">Total Users</span>
                            <span className="font-mono font-bold">Active</span>
                          </div>
                          <div className="flex items-center justify-between p-4 bg-white/5 rounded-2xl">
                            <span className="text-sm text-white/60">Database Connection</span>
                            <span className="text-green-400 text-xs font-bold uppercase tracking-widest">Healthy</span>
                          </div>
                          <div className="flex items-center justify-between p-4 bg-white/5 rounded-2xl">
                            <span className="text-sm text-white/60">API Version</span>
                            <span className="font-mono text-xs">v1.2.0</span>
                          </div>
                        </div>
                      </div>
                      
                      <div className="glass p-8 rounded-3xl border border-white/10">
                        <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
                          <Library size={22} className="text-[#ff4e00]" />
                          Quick Stats
                        </h3>
                        <div className="grid grid-cols-2 gap-4">
                          <div className="p-4 bg-white/5 rounded-2xl">
                            <p className="text-[10px] uppercase tracking-widest text-white/30 mb-1">Playlists</p>
                            <p className="text-2xl font-bold">{playlists.length}</p>
                          </div>
                          <div className="p-4 bg-white/5 rounded-2xl">
                            <p className="text-[10px] uppercase tracking-widest text-white/30 mb-1">Favorites</p>
                            <p className="text-2xl font-bold">{favorites.length}</p>
                          </div>
                          <div className="p-4 bg-white/5 rounded-2xl col-span-2">
                            <p className="text-[10px] uppercase tracking-widest text-white/30 mb-1">Recent Plays</p>
                            <p className="text-2xl font-bold">{history.length}</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </main>
        </div>

        {/* Player */}
        <footer className="h-20 sm:h-24 glass border-t-0 px-4 sm:px-6 flex items-center justify-between z-40 sticky bottom-0">
          <div className="flex items-center gap-3 sm:gap-4 w-1/2 sm:w-1/3">
            {currentSong ? (
              <>
                <div className="w-10 h-10 sm:w-14 sm:h-14 rounded-lg overflow-hidden shadow-lg flex-shrink-0 bg-black relative group cursor-pointer" onClick={() => setIsPlaying(!isPlaying)}>
                  <img src={currentSong.thumbnail} alt={currentSong.title} className="w-full h-full object-cover" />
                  {!isPlaying && (
                    <div className="absolute inset-0 bg-black/40 flex items-center justify-center z-10">
                      <Play size={16} fill="white" className="text-white" />
                    </div>
                  )}
                  {playerError && (
                    <div className="absolute inset-0 bg-red-500/80 flex items-center justify-center z-20 p-1 text-[8px] text-center text-white">
                      {playerError}
                    </div>
                  )}
                </div>
                <div className="overflow-hidden">
                  <h4 className="font-bold truncate text-xs sm:text-sm">{currentSong.title}</h4>
                  <p className="text-[10px] sm:text-xs text-white/40 truncate">{currentSong.author}</p>
                </div>
                <button 
                  onClick={() => {
                    const isFav = favorites.some(f => f.song.id === currentSong.id);
                    isFav ? removeFromFavorites(currentSong.id) : addToFavorites(currentSong);
                  }}
                  className={cn(
                    "p-1.5 sm:p-2 rounded-full transition-all flex-shrink-0",
                    favorites.some(f => f.song.id === currentSong?.id) ? "text-[#ff4e00]" : "text-white/20 hover:text-white"
                  )}
                >
                  <Heart size={16} className="sm:hidden" fill={favorites.some(f => f.song.id === currentSong?.id) ? "currentColor" : "none"} />
                  <Heart size={20} className="hidden sm:block" fill={favorites.some(f => f.song.id === currentSong?.id) ? "currentColor" : "none"} />
                </button>
              </>
            ) : (
              <div className="flex items-center gap-3 sm:gap-4">
                <div className="w-10 h-10 sm:w-14 sm:h-14 bg-white/5 rounded-lg flex items-center justify-center">
                  <Music size={18} className="text-white/10 sm:hidden" />
                  <Music size={24} className="text-white/10 hidden sm:block" />
                </div>
                <div className="hidden xs:block">
                  <h4 className="font-bold text-white/20 text-xs sm:text-sm">No song selected</h4>
                  <p className="text-[10px] sm:text-xs text-white/10">Select a song</p>
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-col items-center gap-1 sm:gap-2 flex-1 sm:w-1/3">
            <div className="flex items-center gap-4 sm:gap-6">
              <button className="text-white/40 hover:text-white transition-colors hidden sm:block">
                <SkipBack size={24} />
              </button>
              <button 
                onClick={() => setIsPlaying(!isPlaying)}
                className="w-10 h-10 sm:w-12 sm:h-12 bg-white text-black rounded-full flex items-center justify-center hover:scale-105 transition-all shadow-lg shadow-white/10"
              >
                {isPlaying ? <Pause size={20} className="sm:hidden" fill="black" /> : <Play size={20} className="sm:hidden ml-0.5" fill="black" />}
                {isPlaying ? <Pause size={24} className="hidden sm:block" fill="black" /> : <Play size={24} className="hidden sm:block ml-1" fill="black" />}
              </button>
              <button onClick={playNext} className="text-white/40 hover:text-white transition-colors">
                <SkipForward size={20} className="sm:hidden" />
                <SkipForward size={24} className="hidden sm:block" />
              </button>
            </div>
            
            <div className="w-full max-w-md hidden sm:flex items-center gap-3">
              <span className="text-[10px] text-white/30 font-mono">{formatTime(currentTime)}</span>
              <div 
                className="flex-1 h-1 bg-white/10 rounded-full relative overflow-hidden group cursor-pointer"
                onClick={handleSeek}
              >
                <div 
                  className="absolute top-0 left-0 h-full bg-[#ff4e00] rounded-full group-hover:bg-[#ff6a2a] transition-all" 
                  style={{ width: `${(currentTime / (duration || 1)) * 100}%` }}
                />
              </div>
              <span className="text-[10px] text-white/30 font-mono">{formatTime(duration) || currentSong?.duration || "0:00"}</span>
            </div>
          </div>

          <div className="hidden sm:flex items-center justify-end gap-4 w-1/3">
            <div className="flex items-center gap-2">
              <Volume2 size={20} className="text-white/40" />
              <div className="w-24 h-1 bg-white/10 rounded-full relative overflow-hidden group cursor-pointer">
                <div className="absolute top-0 left-0 h-full w-2/3 bg-white/40 rounded-full group-hover:bg-white transition-colors" />
              </div>
            </div>
            <button 
              onClick={() => setShowDetailsModal(true)}
              className="p-2 text-white/40 hover:text-white transition-colors flex items-center gap-2"
              title="More Details"
            >
              <Menu size={20} />
              <span className="text-xs font-medium hidden lg:inline">Details</span>
            </button>
          </div>
        </footer>

        {/* Hidden YouTube Player */}
        <div className="fixed bottom-0 left-0 w-1 h-1 opacity-0 pointer-events-none overflow-hidden z-[-1]">
          {currentSong && (
            <YouTube 
              key={currentSong.id}
              videoId={currentSong.id}
              opts={{
                height: '1',
                width: '1',
                playerVars: {
                  autoplay: 1,
                  controls: 0,
                  modestbranding: 1,
                  rel: 0,
                  showinfo: 0,
                  enablejsapi: 1,
                  iv_load_policy: 3,
                  disablekb: 1,
                },
              }}
              onReady={(e) => {
                playerRef.current = e.target;
                setPlayerReady(true);
                setPlayerError(null);
                e.target.setVolume(100);
                if (isPlaying) {
                  e.target.playVideo();
                }
              }}
              onStateChange={(e) => {
                if (e.data === 1) {
                  if (!isPlaying) setIsPlaying(true);
                } else if (e.data === 2) {
                  if (isPlaying) setIsPlaying(false);
                } else if (e.data === 0) {
                  playNext();
                }
              }}
              onEnd={playNext}
              onError={(e) => {
                console.error("YouTube Player Error:", e);
                setPlayerError("Playback error. Skipping...");
                setTimeout(playNext, 2000);
              }}
            />
          )}
        </div>

        {/* Modals */}
        <Modal show={showImportModal} onClose={() => { setShowImportModal(false); setImportError(null); }} title="Import YouTube Playlist">
          <div className="space-y-4">
            <p className="text-sm text-white/60">Paste a YouTube playlist link to import all songs into a new CMusic playlist.</p>
            <input 
              type="text" 
              placeholder="https://www.youtube.com/playlist?list=..."
              className="w-full bg-white/5 border border-white/10 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-[#ff4e00]/50 transition-all"
              value={importUrl}
              onChange={(e) => { setImportUrl(e.target.value); setImportError(null); }}
            />
            {importError && (
              <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-xs">
                {importError}
              </div>
            )}
            <button 
              onClick={handleImportPlaylist}
              disabled={isImporting || !importUrl}
              className="w-full bg-[#ff4e00] text-white py-3 rounded-xl font-bold hover:bg-[#ff4e00]/90 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isImporting ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>
                  <Import size={18} />
                  <span>Import Playlist</span>
                </>
              )}
            </button>
          </div>
        </Modal>

        <Modal show={showPlaylistModal} onClose={() => setShowPlaylistModal(false)} title="Create New Playlist">
          <div className="space-y-4">
            <input 
              type="text" 
              placeholder="Playlist Name"
              className="w-full bg-white/5 border border-white/10 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-[#ff4e00]/50 transition-all"
              value={newPlaylistName}
              onChange={(e) => setNewPlaylistName(e.target.value)}
              autoFocus
            />
            <button 
              onClick={() => createPlaylist(newPlaylistName)}
              disabled={!newPlaylistName.trim()}
              className="w-full bg-[#ff4e00] text-white py-3 rounded-xl font-bold hover:bg-[#ff4e00]/90 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Create Playlist
            </button>
          </div>
        </Modal>

        <Modal show={showApiKeyModal} onClose={() => setShowApiKeyModal(false)} title="Generate API Key">
          <div className="space-y-4">
            <p className="text-sm text-white/60">Give this API key a name to identify which application will be using it.</p>
            <input 
              type="text" 
              placeholder="Application Name (e.g. My Mobile App)"
              className="w-full bg-white/5 border border-white/10 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-[#ff4e00]/50 transition-all"
              value={newApiKeyName}
              onChange={(e) => setNewApiKeyName(e.target.value)}
              autoFocus
            />
            <button 
              onClick={() => generateApiKey(newApiKeyName)}
              disabled={!newApiKeyName.trim()}
              className="w-full bg-[#ff4e00] text-white py-3 rounded-xl font-bold hover:bg-[#ff4e00]/90 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Generate Key
            </button>
          </div>
        </Modal>

        <Modal show={showDetailsModal} onClose={() => setShowDetailsModal(false)} title="Song Details">
          {currentSong ? (
            <div className="space-y-6">
              <div className="aspect-video rounded-2xl overflow-hidden shadow-2xl">
                <img src={currentSong.thumbnail} alt={currentSong.title} className="w-full h-full object-cover" />
              </div>
              <div className="space-y-2">
                <h4 className="text-xl font-bold">{currentSong.title}</h4>
                <p className="text-[#ff4e00] font-medium">{currentSong.author}</p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 bg-white/5 rounded-2xl border border-white/5">
                  <p className="text-[10px] uppercase tracking-widest text-white/30 mb-1">Duration</p>
                  <p className="font-mono text-sm">{formatTime(duration) || currentSong.duration}</p>
                </div>
                <div className="p-4 bg-white/5 rounded-2xl border border-white/5">
                  <p className="text-[10px] uppercase tracking-widest text-white/30 mb-1">Source</p>
                  <p className="text-sm">YouTube</p>
                </div>
              </div>
              <div className="p-4 bg-white/5 rounded-2xl border border-white/5">
                <p className="text-[10px] uppercase tracking-widest text-white/30 mb-1">Video ID</p>
                <p className="font-mono text-xs text-white/60">{currentSong.id}</p>
              </div>
              <button 
                onClick={() => {
                  const isFav = favorites.some(f => f.song.id === currentSong.id);
                  isFav ? removeFromFavorites(currentSong.id) : addToFavorites(currentSong);
                }}
                className={cn(
                  "w-full py-3 rounded-xl font-bold transition-all flex items-center justify-center gap-2",
                  favorites.some(f => f.song.id === currentSong.id) 
                    ? "bg-[#ff4e00]/10 text-[#ff4e00] border border-[#ff4e00]/20" 
                    : "bg-white text-black hover:bg-white/90"
                )}
              >
                <Heart size={18} fill={favorites.some(f => f.song.id === currentSong.id) ? "currentColor" : "none"} />
                {favorites.some(f => f.song.id === currentSong.id) ? "In Favorites" : "Add to Favorites"}
              </button>
            </div>
          ) : (
            <p className="text-center text-white/40 py-8">No song selected</p>
          )}
        </Modal>
      </div>
    </AppContext.Provider>
  );
}

function SidebarItem({ icon, label, active, onClick }: { icon: React.ReactNode, label: string, active?: boolean, onClick: () => void }) {
  return (
    <button 
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-4 px-4 py-3 rounded-xl transition-all group",
        active ? "bg-[#ff4e00] text-white shadow-lg shadow-[#ff4e00]/20" : "text-white/40 hover:text-white hover:bg-white/5"
      )}
    >
      <span className={cn("transition-transform group-hover:scale-110", active ? "text-white" : "text-white/40 group-hover:text-white")}>
        {icon}
      </span>
      <span className="font-semibold">{label}</span>
    </button>
  );
}

function SongCard({ song, playlistId, ...props }: { song: Song, playlistId?: string, [key: string]: any }) {
  const { setCurrentSong, setIsPlaying, currentSong, isPlaying, addToFavorites, removeFromFavorites, favorites, playlists, addToPlaylist, removeFromPlaylist, setShowPlaylistModal } = useApp();
  const [showOptions, setShowOptions] = useState(false);
  
  const isCurrent = currentSong?.id === song.id;
  const isFav = favorites.some(f => f.song.id === song.id);

  return (
    <motion.div 
      whileHover={{ y: -5 }}
      className="group relative bg-white/5 p-3 sm:p-4 rounded-2xl border border-white/5 hover:bg-white/10 transition-all"
    >
      <div className="relative aspect-square rounded-xl overflow-hidden mb-3 sm:mb-4 shadow-xl">
        <img src={song.thumbnail} alt={song.title} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110" />
        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3">
          <button 
            onClick={() => {
              setCurrentSong(song);
              setIsPlaying(true);
            }}
            className="w-10 h-10 sm:w-12 sm:h-12 bg-[#ff4e00] text-white rounded-full flex items-center justify-center hover:scale-110 transition-all shadow-lg"
          >
            {isCurrent && isPlaying ? <Pause size={20} className="sm:hidden" fill="white" /> : <Play size={20} className="sm:hidden ml-0.5" fill="white" />}
            {isCurrent && isPlaying ? <Pause size={24} className="hidden sm:block" fill="white" /> : <Play size={24} className="hidden sm:block ml-1" fill="white" />}
          </button>
        </div>
        
        {/* Mobile quick play overlay */}
        <button 
          onClick={() => {
            setCurrentSong(song);
            setIsPlaying(true);
          }}
          className="absolute inset-0 lg:hidden"
        />

        {isCurrent && (
          <div className="absolute bottom-2 right-2 w-2 h-2 bg-[#ff4e00] rounded-full animate-pulse shadow-[0_0_10px_#ff4e00]" />
        )}
      </div>

      <div className="space-y-1">
        <h4 className="font-bold truncate text-xs sm:text-sm leading-tight">{song.title}</h4>
        <p className="text-[10px] sm:text-xs text-white/40 truncate">{song.author}</p>
      </div>

      <div className="absolute top-4 right-4 sm:top-6 sm:right-6 flex flex-col gap-2 opacity-0 group-hover:opacity-100 lg:group-hover:opacity-100 transition-opacity pointer-events-none group-hover:pointer-events-auto">
        <button 
          onClick={() => isFav ? removeFromFavorites(song.id) : addToFavorites(song)}
          className={cn(
            "p-1.5 sm:p-2 bg-black/60 backdrop-blur-md rounded-full transition-all pointer-events-auto",
            isFav ? "text-[#ff4e00]" : "text-white/60 hover:text-white"
          )}
        >
          <Heart size={14} className="sm:hidden" fill={isFav ? "currentColor" : "none"} />
          <Heart size={16} className="hidden sm:block" fill={isFav ? "currentColor" : "none"} />
        </button>
        <div className="relative pointer-events-auto">
          <button 
            onClick={() => setShowOptions(!showOptions)}
            className="p-1.5 sm:p-2 bg-black/60 backdrop-blur-md rounded-full text-white/60 hover:text-white transition-all"
          >
            <Plus size={14} className="sm:hidden" />
            <Plus size={16} className="hidden sm:block" />
          </button>
          
          {showOptions && (
            <div className="absolute right-0 top-10 w-40 sm:w-48 glass rounded-xl py-2 z-50 shadow-2xl">
              <div className="px-3 py-1 mb-1 border-b border-white/10">
                <p className="text-[10px] font-bold text-white/30 uppercase tracking-widest">Add to playlist</p>
              </div>
              <div className="max-h-40 overflow-y-auto custom-scrollbar">
                {playlists.map(p => (
                  <button 
                    key={p.id}
                    onClick={() => { addToPlaylist(p.id, song); setShowOptions(false); }}
                    className="w-full text-left px-4 py-2 text-[10px] sm:text-xs hover:bg-white/5 transition-colors"
                  >
                    {p.name}
                  </button>
                ))}
                {playlists.length === 0 && (
                  <p className="px-4 py-2 text-[10px] text-white/20 italic">No playlists yet</p>
                )}
              </div>
              <button 
                onClick={() => { setShowPlaylistModal(true); setShowOptions(false); }}
                className="w-full text-left px-4 py-2 text-[10px] sm:text-xs text-[#ff4e00] hover:bg-[#ff4e00]/10 transition-colors border-t border-white/10 mt-1 flex items-center gap-2"
              >
                <Plus size={12} />
                Create New Playlist
              </button>
              {playlistId && (
                <button 
                  onClick={() => { removeFromPlaylist(playlistId, song.id); setShowOptions(false); }}
                  className="w-full text-left px-4 py-2 text-[10px] sm:text-xs text-red-400 hover:bg-red-500/10 transition-colors border-t border-white/10 mt-1"
                >
                  Remove from this playlist
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

function Modal({ show, onClose, title, children }: { show: boolean, onClose: () => void, title: string, children: React.ReactNode }) {
  return (
    <AnimatePresence>
      {show && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/80 backdrop-blur-sm"
          />
          <motion.div 
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            className="relative w-full max-w-md glass rounded-3xl p-8 shadow-2xl"
          >
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-2xl font-serif italic">{title}</h3>
              <button onClick={onClose} className="p-2 hover:bg-white/5 rounded-full text-white/40 hover:text-white transition-colors">
                <X size={20} />
              </button>
            </div>
            {children}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
