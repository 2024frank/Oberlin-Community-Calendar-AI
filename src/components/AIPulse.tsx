import React, { useState, useEffect } from 'react';
import { GoogleGenAI } from "@google/genai";
import { Sparkles, Activity, ShieldAlert, Zap, Quote } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { StagingEvent } from '../types';

interface AIPulseProps {
  events: StagingEvent[];
}

export const AIPulse: React.FC<AIPulseProps> = ({ events }) => {
  const [insight, setInsight] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generateInsight = async () => {
    if (events.length === 0) {
      setInsight("Data lake is currently empty. Start extracting community events to see the AI pulse.");
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      
      const eventData = events.slice(0, 50).map(e => ({
        title: e.title,
        source: e.source,
        date: e.start_date,
        tags: e.tags
      }));

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `
          You are the 'Oberlin Community Pulse' AI, a researcher helping students understand the vibe of the community.
          Analyze these events and provide a 2-3 sentence 'Community Pulse' statement. 
          Identify the dominant 'vibe' (e.g., Intellectual, Artistic, Environmental).
          Be punchy, academic but cool, and use a specific detail from the events.
          
          EVENTS:
          ${JSON.stringify(eventData)}
        `,
        config: {
            temperature: 0.9,
            maxOutputTokens: 200
        }
      });

      setInsight(response.text || "The digital pulse is steady, awaiting further community activity.");
    } catch (err) {
      setError("Failed to sync with the pulse. Check API configuration.");
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    generateInsight();
  }, [events.length]);

  return (
    <div className="bg-white border border-gray-100 rounded-3xl p-6 shadow-sm overflow-hidden relative">
      <div className="absolute top-0 right-0 p-4 opacity-5">
        <Sparkles size={120} className="text-crimson" />
      </div>
      
      <div className="relative z-10">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-crimson/5 flex items-center justify-center text-crimson">
              <Zap size={20} />
            </div>
            <div className="group relative">
              <h3 className="text-sm font-black uppercase tracking-widest text-gray-900">AI Community Pulse</h3>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-tighter">Real-time Meta-Analysis</p>

              {/* Explanation Tooltip */}
              <div className="absolute left-0 top-full mt-2 w-64 p-3 bg-gray-900 text-white text-[10px] rounded-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50 font-medium leading-relaxed shadow-xl">
                Real-time Meta-Analysis: An AI-driven synthesis of current community events to identify dominant themes, sentiment, and engagement opportunities in real-time.
              </div>
            </div>
          </div>
          <button 
            onClick={generateInsight}
            disabled={isLoading}
            className="p-2 hover:bg-gray-50 rounded-xl text-gray-400 transition-colors"
          >
            <Activity size={16} className={isLoading ? "animate-spin" : ""} />
          </button>
        </div>

        <AnimatePresence mode="wait">
          {isLoading ? (
            <motion.div 
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="space-y-2"
            >
              <div className="h-4 bg-gray-100 rounded-lg animate-pulse w-full" />
              <div className="h-4 bg-gray-100 rounded-lg animate-pulse w-3/4" />
              <div className="h-4 bg-gray-100 rounded-lg animate-pulse w-5/6" />
            </motion.div>
          ) : error ? (
            <div className="flex items-center gap-2 text-rose-500 bg-rose-50 p-3 rounded-xl border border-rose-100">
              <ShieldAlert size={14} />
              <span className="text-[10px] font-black uppercase tracking-tight">{error}</span>
            </div>
          ) : (
            <motion.div
              key="content"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="relative"
            >
              <Quote size={40} className="absolute -top-4 -left-4 text-crimson/5" />
              <p className="text-sm text-gray-600 leading-relaxed font-medium italic relative z-10 pl-2 border-l-2 border-crimson/10">
                {insight}
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};
